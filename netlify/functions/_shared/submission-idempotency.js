'use strict';

const crypto = require('crypto');

const STORE_NAME = 'uei-lead-idempotency';
const RETENTION_MS = 24 * 60 * 60 * 1000;

let storeFactory = function () { throw new Error('Blob store runtime is not configured'); };
let testStoreFactoryInstalled = false;

// Conditional writes follow @netlify/blobs 11.1.7: setJSON returns { modified, etag? } and
// supports onlyIfNew / onlyIfMatch. A successful conditional write must carry an etag.
function configureNetlifyStore(getStore) {
  if (testStoreFactoryInstalled) return;
  if (typeof getStore !== 'function') throw new Error('Invalid Blob store runtime');
  storeFactory = function () { return getStore({ name: STORE_NAME, consistency: 'strong' }); };
}

function setStoreFactoryForTests(factory) {
  testStoreFactoryInstalled = Boolean(factory);
  storeFactory = factory || function () { throw new Error('Blob store runtime is not configured'); };
}

function getSubmissionStore() {
  return storeFactory();
}

function validSubmissionId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/.test(String(value || ''));
}

function submissionKey(submissionId) {
  return 'submission:' + crypto.createHash('sha256').update(submissionId).digest('hex');
}

function processingRecord(submissionId, requestId, now) {
  const created = now || new Date();
  return {
    submissionId,
    state: 'processing',
    createdAt: created.toISOString(),
    expiresAt: new Date(created.getTime() + RETENTION_MS).toISOString(),
    requestId: requestId || null,
    response: null
  };
}

function isExpired(record, now) {
  const expiration = Date.parse(record && record.expiresAt);
  return !Number.isFinite(expiration) || expiration <= (now || new Date()).getTime();
}

function won(result) {
  return Boolean(result && result.modified === true && result.etag);
}

async function readRecord(store, key) {
  return store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
}

async function reserveSubmission(store, submissionId, requestId, now) {
  const key = submissionKey(submissionId);
  const record = processingRecord(submissionId, requestId, now);
  const created = await store.setJSON(key, record, { onlyIfNew: true });
  if (won(created)) return { owner: true, key, etag: created.etag, record };

  const existing = await readRecord(store, key);
  if (!existing) {
    const retried = await store.setJSON(key, record, { onlyIfNew: true });
    return won(retried) ? { owner: true, key, etag: retried.etag, record } : { owner: false, key, record: null };
  }
  if (isExpired(existing.data, now)) {
    const replaced = await store.setJSON(key, record, { onlyIfMatch: existing.etag });
    if (won(replaced)) return { owner: true, key, etag: replaced.etag, record };
    const winner = await readRecord(store, key);
    return { owner: false, key, record: winner && winner.data };
  }
  return { owner: false, key, record: existing.data };
}

// state: 'completed' (response is final and replayable) or 'ambiguous' (outcome unknown; never repost).
async function completeSubmission(store, reservation, state, response, now) {
  const completed = now || new Date();
  const record = Object.assign({}, reservation.record, {
    state,
    completedAt: completed.toISOString(),
    response
  });
  const result = await store.setJSON(reservation.key, record, { onlyIfMatch: reservation.etag });
  if (!result || result.modified !== true) throw new Error('Idempotency reservation ownership was lost');
  return record;
}

// Replays return the original outcome and never post again.
function responseForDuplicate(record) {
  if (!record || record.state === 'processing') {
    return { statusCode: 202, body: { outcome: 'pending' } };
  }
  if (record.state === 'completed' && record.response) {
    return { statusCode: 200, body: Object.assign({}, record.response, { replay: true }) };
  }
  return { statusCode: 502, body: { outcome: 'ambiguous', retryable: false, replay: true } };
}

module.exports = {
  RETENTION_MS,
  STORE_NAME,
  completeSubmission,
  configureNetlifyStore,
  getSubmissionStore,
  reserveSubmission,
  responseForDuplicate,
  setStoreFactoryForTests,
  submissionKey,
  validSubmissionId
};
