'use strict';

const fs = require('fs');
const path = require('path');

const STORE_NAME = 'uei-runtime-availability';
const DEFAULT_PATH = path.join(__dirname, '..', '..', 'config', 'availability.json');

let storeFactory = function () { throw new Error('Blob store runtime is not configured'); };
let testStoreFactoryInstalled = false;

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
    return raw ? JSON.parse(raw) : { currentVersion: null, versions: [], manualPauses: { campuses: {}, offerings: {} }, capPauses: { campuses: {}, offerings: {} } };
  } catch (error) {
    return { currentVersion: null, versions: [], manualPauses: { campuses: {}, offerings: {} }, capPauses: { campuses: {}, offerings: {} } };
  }
}

async function loadRuntimeAvailability(options) {
  const settings = options || {};
  if (settings.store) {
    const store = settings.store;
    try {
      const result = await store.get('runtime-availability', { type: 'json', consistency: 'strong' });
      return result || readFileState();
    } catch (error) {
      return readFileState();
    }
  }
  return readFileState();
}

async function writeRuntimeAvailability(runtimeState, options) {
  const settings = options || {};
  const state = runtimeState || readFileState();
  if (settings.store) {
    await settings.store.setJSON('runtime-availability', state, { consistency: 'strong' });
    return state;
  }
  fs.writeFileSync(DEFAULT_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
  return state;
}

module.exports = {
  STORE_NAME,
  configureNetlifyStore,
  getRuntimeAvailabilityStore,
  loadRuntimeAvailability,
  setStoreFactoryForTests,
  writeRuntimeAvailability
};
