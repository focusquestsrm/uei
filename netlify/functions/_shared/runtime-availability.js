'use strict';

const fs = require('fs');
const path = require('path');

const STORE_NAME = 'uei-runtime-availability';
const DEFAULT_PATH = path.join(__dirname, '..', '..', '..', 'config', 'availability.json');
const STORE_KEY = 'runtime-availability';
const EMPTY_STATE = Object.freeze({
  currentVersion: null,
  pendingVersion: null,
  versions: [],
  manualPauses: { campuses: {}, offerings: {} },
  capPauses: { campuses: {}, offerings: {} }
});

let storeFactory = function () { throw new Error('Blob store runtime is not configured'); };
let testStoreFactoryInstalled = false;

function normalizeState(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    currentVersion: source.currentVersion || null,
    pendingVersion: source.pendingVersion || null,
    versions: Array.isArray(source.versions) ? source.versions : [],
    manualPauses: {
      campuses: source.manualPauses && source.manualPauses.campuses && typeof source.manualPauses.campuses === 'object' ? source.manualPauses.campuses : {},
      offerings: source.manualPauses && source.manualPauses.offerings && typeof source.manualPauses.offerings === 'object' ? source.manualPauses.offerings : {}
    },
    capPauses: {
      campuses: source.capPauses && source.capPauses.campuses && typeof source.capPauses.campuses === 'object' ? source.capPauses.campuses : {},
      offerings: source.capPauses && source.capPauses.offerings && typeof source.capPauses.offerings === 'object' ? source.capPauses.offerings : {}
    }
  };
}

function configureNetlifyStore(getStore) {
  if (testStoreFactoryInstalled) return;
  if (typeof getStore !== 'function') throw new Error('Invalid Blob store runtime');
  storeFactory = function () { return getStore({ name: STORE_NAME, consistency: 'strong' }); };
}

function setStoreFactoryForTests(factory) {
  testStoreFactoryInstalled = Boolean(factory);
  storeFactory = factory || function () { throw new Error('Blob store runtime is not configured'); };
}

function getRuntimeAvailabilityStore() {
  return storeFactory();
}

function readFileState() {
  try {
    const raw = fs.readFileSync(DEFAULT_PATH, 'utf8');
    return raw ? normalizeState(JSON.parse(raw)) : EMPTY_STATE;
  } catch (error) {
    return EMPTY_STATE;
  }
}

function canUseFileFallback(settings) {
  if (settings && settings.allowFileFallback === false) return false;
  try {
    getRuntimeAvailabilityStore();
    return false;
  } catch (error) {
    return true;
  }
}

function isMutatingFailure(error) {
  return Boolean(error && error.message && (/etag/i.test(error.message) || /conflict/i.test(error.message) || /onlyifmatch/i.test(error.message)));
}

async function loadRuntimeAvailability(options) {
  const settings = options || {};
  let store = settings.store;
  if (!store) {
    try {
      store = getRuntimeAvailabilityStore();
    } catch (error) {
      if (canUseFileFallback(settings)) {
        return { status: 'ok', state: readFileState(), etag: null, error: null, source: 'file' };
      }
      return { status: 'missing', state: EMPTY_STATE, etag: null, error: 'No runtime availability store is configured.' };
    }
  }
  if (!store) return { status: 'missing', state: EMPTY_STATE, etag: null, error: 'No runtime availability store is configured.' };

  if (typeof store.getWithMetadata === 'function') {
    try {
      const result = await store.getWithMetadata(STORE_KEY);
      if (!result || !result.data) {
        if (canUseFileFallback(settings)) {
          return { status: 'ok', state: readFileState(), etag: null, error: null, source: 'file' };
        }
        return { status: 'missing', state: EMPTY_STATE, etag: null, error: 'Runtime availability has not been initialized in durable storage.' };
      }
      return { status: 'ok', state: normalizeState(result.data), etag: result.etag || null, error: null };
    } catch (error) {
      return { status: 'storage_error', state: EMPTY_STATE, etag: null, error: error && error.message ? error.message : String(error) };
    }
  }

  if (typeof store.get === 'function') {
    try {
      const result = await store.get(STORE_KEY, { type: 'json', consistency: 'strong' });
      if (!result) {
        if (canUseFileFallback(settings)) {
          return { status: 'ok', state: readFileState(), etag: null, error: null, source: 'file' };
        }
        return { status: 'missing', state: EMPTY_STATE, etag: null, error: 'Runtime availability has not been initialized in durable storage.' };
      }
      return { status: 'ok', state: normalizeState(result), etag: null, error: null };
    } catch (error) {
      return { status: 'storage_error', state: EMPTY_STATE, etag: null, error: error && error.message ? error.message : String(error) };
    }
  }

  if (canUseFileFallback(settings)) {
    return { status: 'ok', state: readFileState(), etag: null, error: null, source: 'file' };
  }

  return { status: 'missing', state: EMPTY_STATE, etag: null, error: 'Runtime availability store does not support a durable read API.' };
}

async function writeRuntimeAvailability(runtimeState, options) {
  const settings = options || {};
  const state = normalizeState(runtimeState || EMPTY_STATE);
  const store = settings.store || getRuntimeAvailabilityStore();
  if (!store || typeof store.setJSON !== 'function') {
    return { status: 'missing', state, modified: false, etag: null, error: 'Runtime availability store is not configured.' };
  }

  const payload = { consistency: 'strong' };
  if (settings.ifMatch) payload.onlyIfMatch = settings.ifMatch;
  if (settings.onlyIfNew) payload.onlyIfNew = true;

  try {
    const result = await store.setJSON(STORE_KEY, state, payload);
    const etag = result && result.etag ? result.etag : settings.ifMatch || null;
    if (result && result.modified === false) {
      return { status: 'conflict', state, modified: false, etag, error: 'Runtime availability changed since the previous version was read.' };
    }
    return { status: 'ok', state, modified: true, etag, error: null };
  } catch (error) {
    return { status: 'storage_error', state, modified: false, etag: settings.ifMatch || null, error: error && error.message ? error.message : String(error) };
  }
}

async function publishRuntimeAvailability(runtimeState, options) {
  const settings = options || {};
  const store = settings.store || getRuntimeAvailabilityStore();
  const maxAttempts = settings.maxAttempts || 3;
  let candidate = normalizeState(runtimeState || EMPTY_STATE);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const latest = await loadRuntimeAvailability({ store });
    const etag = latest && latest.etag ? latest.etag : null;
    const result = await writeRuntimeAvailability(candidate, { store, ifMatch: etag || settings.ifMatch || undefined, onlyIfNew: settings.onlyIfNew || false });
    if (result.status === 'ok') return result;
    if (result.status === 'conflict' && attempt < maxAttempts - 1) {
      candidate = latest.state || candidate;
      continue;
    }
    return result;
  }
  return { status: 'conflict', state: candidate, modified: false, etag: null, error: 'Conflict retries were exhausted.' };
}

module.exports = {
  STORE_KEY,
  STORE_NAME,
  EMPTY_STATE,
  DEFAULT_PATH,
  configureNetlifyStore,
  getRuntimeAvailabilityStore,
  isMutatingFailure,
  loadRuntimeAvailability,
  normalizeState,
  publishRuntimeAvailability,
  readFileState,
  setStoreFactoryForTests,
  writeRuntimeAvailability
};
