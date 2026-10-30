'use strict';

const campusConfig = require('../config/campus-programs.json');

const ORIGIN = 'https://site.test';
const ENV = Object.freeze({
  LEAD_SUBMISSION_ENABLED: 'true',
  LEAD_TEST_MODE: 'true',
  SITE_URL: ORIGIN,
  LEADHOOP_CAMPAIGN_CODE: 'DUMMYCAMPAIGNCODE123'
});

// In-memory store matching the @netlify/blobs 11.1.7 conditional-write contract.
function memoryStore() {
  const data = new Map();
  let counter = 0;
  return {
    data,
    async setJSON(key, value, options) {
      const existing = data.get(key);
      if (options && options.onlyIfNew && existing) return { modified: false };
      if (options && options.onlyIfMatch && (!existing || existing.etag !== options.onlyIfMatch)) return { modified: false };
      counter += 1;
      const etag = 'etag-' + counter;
      data.set(key, { value: JSON.parse(JSON.stringify(value)), etag });
      return { modified: true, etag };
    },
    async getWithMetadata(key) {
      const entry = data.get(key);
      return entry ? { data: JSON.parse(JSON.stringify(entry.value)), etag: entry.etag } : null;
    }
  };
}

function firstActive() {
  const campus = campusConfig.campuses.find(function (entry) { return entry.active; });
  const offering = campusConfig.offerings.find(function (entry) { return entry.campus === campus.id && entry.active; });
  return { campus, program: campusConfig.programs.find(function (entry) { return entry.id === offering.program; }) };
}

let sequence = 0;
function validBody(overrides) {
  const pick = firstActive();
  sequence += 1;
  return Object.assign({
    submissionId: 'test-submission-' + String(sequence).padStart(8, '0'),
    campus: pick.campus.id,
    program: pick.program.id,
    education: '2274',
    gradYear: '2015',
    age: '30',
    gender: 'F',
    military: 'N',
    address: '123 Main St',
    address2: '',
    city: 'Sampletown',
    state: 'CA',
    zip: pick.campus.zips[0],
    firstName: 'Testy',
    lastName: 'Person',
    email: 'testy@example.com',
    phone: '(555) 234-5678',
    startDate: 'Immediately',
    consent: 'Y',
    leadIdToken: '0123ABCD-4567-89ab-cdef-0123456789AB',
    consentUrl: ORIGIN + '/?utm_source=x'
  }, overrides);
}

function event(body, extra) {
  return Object.assign({
    httpMethod: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    clientIp: '198.51.100.23'
  }, extra);
}

function vendorFetch(responses) {
  const calls = [];
  const queue = Array.isArray(responses) ? responses.slice() : null;
  const impl = async function (url, init) {
    calls.push({ url, init, params: new URLSearchParams(init.body) });
    const next = queue ? queue.shift() : responses;
    if (typeof next === 'function') return next(init);
    return { status: next.status, text: async () => next.body };
  };
  impl.calls = calls;
  return impl;
}

const SUCCESS = Object.freeze({ status: 200, body: '{"status":"success","testing":true}' });

module.exports = { ENV, ORIGIN, SUCCESS, campusConfig, event, memoryStore, validBody, vendorFetch };
