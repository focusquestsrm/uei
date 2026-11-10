'use strict';

const fs = require('fs');
const path = require('path');

const STORE_NAME = 'uei-runtime-availability';
const DEFAULT_PATH = path.join(__dirname, 'bundled-config', 'availability.json');
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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidDateString(value) {
  if (value === null || value === undefined || value === '') return true;
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime());
}

function validateVersionDateRange(entry) {
  if (!entry || !isPlainObject(entry)) return false;
  if (!entry.effectiveDate || !isValidDateString(entry.effectiveDate)) return false;
  if (entry.expiresAt !== undefined && entry.expiresAt !== null && entry.expiresAt !== '') {
    if (!isValidDateString(entry.expiresAt)) return false;
    const effectiveMs = new Date(entry.effectiveDate).getTime();
    const expiresMs = new Date(entry.expiresAt).getTime();
    if (!(expiresMs > effectiveMs)) return false;
  }
  return true;
}

function normalizeState(value) {
  const source = isPlainObject(value) ? value : {};
  const versions = Array.isArray(source.versions) ? source.versions.filter(function (entry) { return entry && typeof entry === 'object'; }) : [];
  return {
    currentVersion: source.currentVersion && typeof source.currentVersion === 'string' ? source.currentVersion : null,
    pendingVersion: source.pendingVersion && typeof source.pendingVersion === 'string' ? source.pendingVersion : null,
    versions: versions.map(function (entry) {
      const version = isPlainObject(entry) ? entry : {};
      return {
        id: version.id && typeof version.id === 'string' ? version.id : '',
        effectiveDate: isValidDateString(version.effectiveDate) ? version.effectiveDate : null,
        expiresAt: isValidDateString(version.expiresAt) ? version.expiresAt : null,
        campuses: isPlainObject(version.campuses) ? Object.assign({}, version.campuses) : {},
        offerings: isPlainObject(version.offerings) ? Object.assign({}, version.offerings) : {}
      };
    }),
    manualPauses: {
      campuses: isPlainObject(source.manualPauses) && isPlainObject(source.manualPauses.campuses) ? Object.assign({}, source.manualPauses.campuses) : {},
      offerings: isPlainObject(source.manualPauses) && isPlainObject(source.manualPauses.offerings) ? Object.assign({}, source.manualPauses.offerings) : {}
    },
    capPauses: {
      campuses: isPlainObject(source.capPauses) && isPlainObject(source.capPauses.campuses) ? Object.assign({}, source.capPauses.campuses) : {},
      offerings: isPlainObject(source.capPauses) && isPlainObject(source.capPauses.offerings) ? Object.assign({}, source.capPauses.offerings) : {}
    }
  };
}

function validateRuntimeStateShape(value) {
  if (!isPlainObject(value)) return false;
  if (value.currentVersion !== null && value.currentVersion !== undefined && typeof value.currentVersion !== 'string') return false;
  if (value.pendingVersion !== null && value.pendingVersion !== undefined && typeof value.pendingVersion !== 'string') return false;
  if (!Array.isArray(value.versions)) return false;
  for (const entry of value.versions) {
    if (!isPlainObject(entry)) return false;
    if (!entry.id || typeof entry.id !== 'string' || !String(entry.id).trim()) return false;
    if (!validateVersionDateRange(entry)) return false;
    if (entry.campuses !== undefined && !isPlainObject(entry.campuses)) return false;
    if (entry.offerings !== undefined && !isPlainObject(entry.offerings)) return false;
  }
  if (value.manualPauses !== undefined && (!isPlainObject(value.manualPauses) || !isPlainObject(value.manualPauses.campuses) || !isPlainObject(value.manualPauses.offerings))) return false;
  if (value.capPauses !== undefined && (!isPlainObject(value.capPauses) || !isPlainObject(value.capPauses.campuses) || !isPlainObject(value.capPauses.offerings))) return false;
  return true;
}

function deserializeStoredState(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  }
  if (typeof value === 'object') return value;
  return null;
}

function mergeRuntimeState(baseState, nextState) {
  const current = normalizeState(baseState);
  const incoming = normalizeState(nextState);
  const mergedVersions = [];
  const seen = new Set();
  [current.versions, incoming.versions].forEach(function (versions) {
    (Array.isArray(versions) ? versions : []).forEach(function (version) {
      if (!version || !version.id || seen.has(version.id)) return;
      seen.add(version.id);
      mergedVersions.push(version);
    });
  });
  const merged = {
    currentVersion: incoming.currentVersion || current.currentVersion || null,
    pendingVersion: incoming.pendingVersion || current.pendingVersion || null,
    versions: mergedVersions,
    manualPauses: {
      campuses: Object.assign({}, current.manualPauses.campuses, incoming.manualPauses.campuses),
      offerings: Object.assign({}, current.manualPauses.offerings, incoming.manualPauses.offerings)
    },
    capPauses: {
      campuses: Object.assign({}, current.capPauses.campuses, incoming.capPauses.campuses),
      offerings: Object.assign({}, current.capPauses.offerings, incoming.capPauses.offerings)
    }
  };
  return normalizeState(merged);
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
    if (!raw) return EMPTY_STATE;
    const parsed = deserializeStoredState(raw);
    if (!parsed || !validateRuntimeStateShape(parsed)) return EMPTY_STATE;
    return normalizeState(parsed);
  } catch (error) {
    return EMPTY_STATE;
  }
}

function canUseFileFallback(settings, storeWasConfigured) {
  if (settings && settings.allowFileFallback === false) return false;
  if (settings && settings.allowFileFallback === true) return true;
  if (settings && settings.store && settings.store.data instanceof Map) return true;
  return !storeWasConfigured;
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
      if (canUseFileFallback(settings, false)) {
        return { status: 'ok', state: readFileState(), etag: null, error: null, source: 'file' };
      }
      return { status: 'missing', state: EMPTY_STATE, etag: null, error: 'No runtime availability store is configured.' };
    }
  }
  if (!store) return { status: 'missing', state: EMPTY_STATE, etag: null, error: 'No runtime availability store is configured.' };

  if (typeof store.getWithMetadata === 'function') {
    try {
      const result = await store.getWithMetadata(STORE_KEY);
      if (!result || result.data === undefined || result.data === null) {
        if (canUseFileFallback(settings, true)) {
          return { status: 'ok', state: readFileState(), etag: null, error: null, source: 'file' };
        }
        return { status: 'missing', state: EMPTY_STATE, etag: null, error: 'Runtime availability has not been initialized in durable storage.' };
      }
      const parsed = deserializeStoredState(result.data);
      if (!parsed || !validateRuntimeStateShape(parsed)) {
        return { status: 'storage_error', state: EMPTY_STATE, etag: result.etag || null, error: 'Stored runtime availability is malformed JSON or a non-runtime object.' };
      }
      return { status: 'ok', state: normalizeState(parsed), etag: result.etag || null, error: null };
    } catch (error) {
      return { status: 'storage_error', state: EMPTY_STATE, etag: null, error: error && error.message ? error.message : String(error) };
    }
  }

  if (typeof store.get === 'function') {
    try {
      const result = await store.get(STORE_KEY, { type: 'json', consistency: 'strong' });
      if (result === undefined || result === null) {
        if (canUseFileFallback(settings, true)) {
          return { status: 'ok', state: readFileState(), etag: null, error: null, source: 'file' };
        }
        return { status: 'missing', state: EMPTY_STATE, etag: null, error: 'Runtime availability has not been initialized in durable storage.' };
      }
      const parsed = deserializeStoredState(result);
      if (!parsed || !validateRuntimeStateShape(parsed)) {
        return { status: 'storage_error', state: EMPTY_STATE, etag: null, error: 'Stored runtime availability is malformed JSON or a non-runtime object.' };
      }
      return { status: 'ok', state: normalizeState(parsed), etag: null, error: null };
    } catch (error) {
      return { status: 'storage_error', state: EMPTY_STATE, etag: null, error: error && error.message ? error.message : String(error) };
    }
  }

  if (canUseFileFallback(settings, true)) {
    return { status: 'ok', state: readFileState(), etag: null, error: null, source: 'file' };
  }

  return { status: 'missing', state: EMPTY_STATE, etag: null, error: 'Runtime availability store does not support a durable read API.' };
}

async function writeRuntimeAvailability(runtimeState, options) {
  const settings = options || {};
  const source = runtimeState || EMPTY_STATE;
  if (!validateRuntimeStateShape(source)) {
    return { status: 'invalid', state: normalizeState(source), modified: false, etag: settings.ifMatch || null, error: 'Runtime availability state is invalid: effectiveDate is required and expiresAt must be later than effectiveDate.' };
  }
  const state = normalizeState(source);
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

function buildPublicationCandidate(currentState, desiredState) {
  const current = normalizeState(currentState || EMPTY_STATE);
  const desired = normalizeState(desiredState || EMPTY_STATE);
  const mergedVersions = (Array.isArray(current.versions) ? current.versions.slice() : []).map(function (version) {
    return {
      id: version.id,
      effectiveDate: version.effectiveDate || null,
      expiresAt: version.expiresAt || null,
      campuses: Object.assign({}, version.campuses || {}),
      offerings: Object.assign({}, version.offerings || {})
    };
  });
  const seen = new Map();
  mergedVersions.forEach(function (version, index) {
    if (version && version.id) seen.set(version.id, index);
  });

  (Array.isArray(desired.versions) ? desired.versions : []).forEach(function (version) {
    if (!version || !version.id) return;
    const replacementIndex = seen.get(version.id);
    const normalized = {
      id: version.id,
      effectiveDate: version.effectiveDate || null,
      expiresAt: version.expiresAt || null,
      campuses: Object.assign({}, version.campuses || {}),
      offerings: Object.assign({}, version.offerings || {})
    };
    if (replacementIndex !== undefined) {
      mergedVersions[replacementIndex] = normalized;
      return;
    }
    seen.set(version.id, mergedVersions.length);
    mergedVersions.push(normalized);
  });

  const nextManualPauses = {
    campuses: Object.assign({}, current.manualPauses && current.manualPauses.campuses ? current.manualPauses.campuses : {}),
    offerings: Object.assign({}, current.manualPauses && current.manualPauses.offerings ? current.manualPauses.offerings : {})
  };
  const nextCapPauses = {
    campuses: Object.assign({}, current.capPauses && current.capPauses.campuses ? current.capPauses.campuses : {}),
    offerings: Object.assign({}, current.capPauses && current.capPauses.offerings ? current.capPauses.offerings : {})
  };

  return normalizeState({
    currentVersion: desired.currentVersion || current.currentVersion || null,
    pendingVersion: desired.pendingVersion || current.pendingVersion || null,
    versions: mergedVersions,
    manualPauses: nextManualPauses,
    capPauses: nextCapPauses
  });
}

async function publishRuntimeAvailability(runtimeState, options) {
  const settings = options || {};
  const store = settings.store || getRuntimeAvailabilityStore();
  const maxAttempts = settings.maxAttempts || 3;
  const source = runtimeState || EMPTY_STATE;
  if (!validateRuntimeStateShape(source)) {
    return { status: 'invalid', state: normalizeState(source), modified: false, etag: null, error: 'Runtime availability state is invalid: effectiveDate is required and expiresAt must be later than effectiveDate.' };
  }
  const desiredState = normalizeState(source);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const latest = await loadRuntimeAvailability({ store, allowFileFallback: false });
    if (latest.status === 'storage_error') return { status: 'storage_error', state: desiredState, modified: false, etag: null, error: latest.error };
    if (latest.status === 'missing') {
      const result = await writeRuntimeAvailability(desiredState, { store, onlyIfNew: true });
      if (result.status === 'ok') return result;
      if (result.status === 'conflict' && attempt < maxAttempts - 1) continue;
      return result;
    }
    const candidate = buildPublicationCandidate(latest.state, desiredState);
    const result = await writeRuntimeAvailability(candidate, { store, ifMatch: latest.etag || undefined });
    if (result.status === 'ok') return result;
    if (result.status === 'conflict' && attempt < maxAttempts - 1) {
      continue;
    }
    return result;
  }
  return { status: 'conflict', state: normalizeState(desiredState), modified: false, etag: null, error: 'Conflict retries were exhausted.' };
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
