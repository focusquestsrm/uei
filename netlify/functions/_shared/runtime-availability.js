'use strict';

const fs = require('fs');
const path = require('path');

const STORE_NAME = 'uei-runtime-availability';
const DEFAULT_PATH = path.join(__dirname, '..', '..', 'config', 'availability.json');
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

async function loadRuntimeAvailability(options) {
  const settings = options || {};
  const store = settings.store || getRuntimeAvailabilityStore();
  if (store) {
    if (typeof store.get === 'function') {
      try {
        const result = await store.get('runtime-availability', { type: 'json', consistency: 'strong' });
        return normalizeState(result || readFileState());
      } catch (error) {
        return normalizeState(readFileState());
      }
    }
    if (typeof store.getWithMetadata === 'function') {
      try {
        const result = await store.getWithMetadata('runtime-availability');
        return normalizeState(result && result.data ? result.data : readFileState());
      } catch (error) {
        return normalizeState(readFileState());
      }
    }
  }
  return normalizeState(readFileState());
}

async function writeRuntimeAvailability(runtimeState, options) {
  const settings = options || {};
  const state = normalizeState(runtimeState || readFileState());
  if (settings.store && typeof settings.store.setJSON === 'function') {
    const payload = { consistency: 'strong' };
    if (settings.ifMatch) payload.onlyIfMatch = settings.ifMatch;
    if (settings.onlyIfNew) payload.onlyIfNew = true;
    try {
      const result = await settings.store.setJSON('runtime-availability', state, payload);
      return Object.assign({ state, modified: result && result.modified !== false }, result || {});
    } catch (error) {
      if (settings.fallbackToFile !== false) {
        fs.writeFileSync(DEFAULT_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
      }
      return { state, modified: false, error: error && error.message ? error.message : String(error) };
    }
  }
  fs.writeFileSync(DEFAULT_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
  return { state, modified: true };
}

module.exports = {
  STORE_NAME,
  EMPTY_STATE,
  configureNetlifyStore,
  getRuntimeAvailabilityStore,
  loadRuntimeAvailability,
  normalizeState,
  readFileState,
  setStoreFactoryForTests,
  writeRuntimeAvailability
};
