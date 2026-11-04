'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const phone = require('../src/js/phone');
const address = require('../src/js/address');
const rules = require('../src/js/rules');
const catalog = require('../src/js/catalog');
const runtimeAvailability = require('../netlify/functions/_shared/runtime-availability');
const { classify } = require('../netlify/functions/_shared/leadhoop-response');
const { readConfiguration } = require('../netlify/functions/_shared/config');
const { campusConfig } = require('./helpers');

test('phone normalizes and formats for the vendor', () => {
  assert.equal(phone.normalize('(555) 234-5678'), '5552345678');
  assert.equal(phone.normalize('+1 555-234-5678'), '5552345678');
  assert.equal(phone.normalize('15552345678'), '5552345678');
  assert.equal(phone.normalize('555234567'), null);
  assert.equal(phone.normalize('1555234567'), null);
  assert.equal(phone.normalize('555-234-5678 ext 1'), null);
  assert.equal(phone.normalize('1112345678'), null);
  assert.equal(phone.formatForVendor('5552345678'), '(555) 234-5678');
});

test('address rules follow the posting specification', () => {
  assert.ok(address.isValidStreetAddress('123 Main St'));
  assert.ok(address.isValidStreetAddress("45 O'Brien Ave #2"));
  assert.ok(!address.isValidStreetAddress('Main Street'));
  assert.ok(!address.isValidStreetAddress('12345'));
  assert.ok(!address.isValidStreetAddress('123Main'));
  assert.ok(!address.isValidStreetAddress('123 Main St!'));
  assert.ok(!address.isValidStreetAddress('1 www.spam.com'));
  assert.ok(address.isValidAddress2(''));
  assert.ok(address.isValidAddress2('Apt 4B'));
  assert.ok(!address.isValidAddress2('Apt <4>'));
  assert.ok(address.isValidCity('San Luis Obispo'));
  assert.ok(!address.isValidCity('X'));
  ['AA', 'AE', 'AP', 'PR', 'VI', 'AS', 'GU', 'MP'].forEach((code) => assert.ok(!address.isValidStateCode(code), code));
  assert.ok(address.isValidStateCode('wa'));
  assert.ok(address.isValidZipCode('01234'));
  assert.ok(!address.isValidZipCode('1234'));
});

test('campaign limits are enforced', () => {
  assert.ok(rules.isValidGradYear('1998') && rules.isValidGradYear('2024'));
  assert.ok(!rules.isValidGradYear('1997') && !rules.isValidGradYear('2025'));
  assert.ok(rules.isValidAge('18') && !rules.isValidAge('17'));
  assert.ok(rules.isValidEducation('2274') && !rules.isValidEducation('2273'));
  assert.ok(rules.isValidMilitary('Y') && rules.isValidMilitary('N') && !rules.isValidMilitary(''));
  assert.ok(rules.isValidLeadIdToken('0123ABCD-4567-89ab-cdef-0123456789AB'));
  assert.ok(!rules.isValidLeadIdToken('short'));
  assert.equal(rules.gradYears().length, 27);
});

test('catalog source is structurally valid and ZIPs do not overlap', () => {
  assert.deepEqual(catalog.validateConfig(campusConfig), []);
  const seen = new Map();
  campusConfig.campuses.forEach((campus) => campus.zips.forEach((zip) => {
    assert.ok(!seen.has(zip) || seen.get(zip) === campus.id, 'ZIP overlap ' + zip);
    seen.set(zip, campus.id);
  }));
  assert.equal(seen.size, 301);
});

test('public choices expose only active options and no routing IDs', () => {
  const pub = catalog.buildPublic(campusConfig);
  assert.ok(catalog.validatePublic(pub));
  const text = JSON.stringify(pub);
  assert.ok(!pub.campuses.some((campus) => campus.id === 'oceanside'));
  const gardena = pub.campuses.find((campus) => campus.id === 'gardena');
  assert.deepEqual(gardena.programs.map((program) => program.id), ['electrician-technician', 'hvac']);
  campusConfig.campuses.forEach((campus) => assert.ok(!text.includes(campus.leadHoopId)));
  campusConfig.programs.forEach((program) => assert.ok(!text.includes('"' + program.leadHoopId + '"')));
});

test('server selection resolution rejects paused, unknown, and out-of-area choices', () => {
  const bakersfield = campusConfig.campuses.find((campus) => campus.id === 'bakersfield');
  const zip = bakersfield.zips[0];
  assert.ok(catalog.resolveSelection(campusConfig, 'bakersfield', 'dental-assistant', zip).ok);
  assert.equal(catalog.resolveSelection(campusConfig, 'bakersfield', 'medical-office-specialist', zip).reason, 'unknown');
  assert.equal(catalog.resolveSelection(campusConfig, 'oceanside', 'hvac', campusConfig.campuses.find((c) => c.id === 'oceanside').zips[0]).reason, 'paused');
  assert.equal(catalog.resolveSelection(campusConfig, 'gardena', 'medical-assistant', campusConfig.campuses.find((c) => c.id === 'gardena').zips[0]).reason, 'paused');
  assert.equal(catalog.resolveSelection(campusConfig, 'bakersfield', 'dental-assistant', '10001').reason, 'zip');
  assert.equal(catalog.resolveSelection(campusConfig, 'nowhere', 'hvac', zip).reason, 'unknown');
});

test('vendor response classification', () => {
  assert.equal(classify(200, '{"status":"success","testing":true}').kind, 'accepted');
  assert.equal(classify(500, '{"status":"success"}').kind, 'http_failure');
  assert.equal(classify(200, '{"status":"failure","reason":"Advertiser rejected post."}').kind, 'rejected');
  assert.equal(classify(200, '{"status":"failure","reason":{"base":["Reached campaign/offer cap for x"]}}').kind, 'rejected');
  assert.equal(classify(200, '{"status":"failure","reason":{"lead[phone1]":["is invalid"]}}').kind, 'invalid_request');
  assert.equal(classify(200, '{"status":"failure","reason":{"base":["Duplicate lead"]}}').kind, 'duplicate');
  assert.equal(classify(200, '{"status":"failure","reason":{"campaign_code":["Campaign not available."]}}').kind, 'configuration');
  assert.equal(classify(200, '<html>').kind, 'ambiguous');
  assert.equal(classify(200, '').kind, 'ambiguous');
});

test('configuration gates posting', () => {
  const base = { LEAD_SUBMISSION_ENABLED: 'true', LEAD_TEST_MODE: 'false', SITE_URL: 'https://a.test', LEADHOOP_CAMPAIGN_CODE: 'ABCDEFGH1234' };
  assert.equal(readConfiguration(base).ready, true);
  assert.equal(readConfiguration(base).testMode, false);
  assert.equal(readConfiguration(Object.assign({}, base, { LEAD_SUBMISSION_ENABLED: 'false' })).ready, false);
  assert.equal(readConfiguration(Object.assign({}, base, { LEAD_TEST_MODE: '' })).ready, false);
  assert.equal(readConfiguration(Object.assign({}, base, { LEAD_TEST_MODE: '' })).testMode, true);
  assert.equal(readConfiguration(Object.assign({}, base, { SITE_URL: '' })).ready, false);
  assert.equal(readConfiguration(Object.assign({}, base, { SITE_URL: 'http://evil.test' })).ready, false);
  assert.equal(readConfiguration(Object.assign({}, base, { LEADHOOP_CAMPAIGN_CODE: '' })).ready, false);
});

const availability = require('../src/js/availability');
const capHandling = require('../netlify/functions/_shared/cap-handling');

test('scheduled availability chooses the active version and honors manual pause precedence', () => {
  const state = {
    currentVersion: '2026-11',
    versions: [
      { id: '2026-11', effectiveDate: '2026-11-01T00:00:00-05:00', expiresAt: '2026-12-01T00:00:00-05:00', campuses: { oceanside: false }, offerings: { 'oceanside/hvac': false } },
      { id: '2026-12', effectiveDate: '2026-12-01T00:00:00-05:00', campuses: { }, offerings: { } }
    ],
    manualPauses: { campuses: { oceanside: false }, offerings: { 'gardena/medical-assistant': false } },
    capPauses: { campuses: {}, offerings: {} }
  };
  const runtime = availability.resolveRuntime(campusConfig, state, new Date('2026-11-05T12:00:00-05:00'));
  assert.equal(runtime.currentVersion, '2026-11');
  assert.equal(runtime.campuses.oceanside.active, false);
  assert.equal(runtime.offerings['oceanside/hvac'].active, false);
  assert.equal(runtime.offerings['gardena/medical-assistant'].active, false);
});

test('cap response detection pauses only the matching scope and ignores test leads', () => {
  const baseState = { currentVersion: '2026-11', manualPauses: { campuses: {}, offerings: {} }, capPauses: { campuses: {}, offerings: {} }, versions: [] };
  const campusPause = capHandling.applyCapPause(baseState, 'bakersfield', 'dental-assistant', 'Reached campus cap for Bakersfield.', { testMode: false });
  assert.equal(campusPause.changed, true);
  assert.equal(campusPause.scope, 'campus');
  assert.equal(campusPause.runtimeState.capPauses.campuses.bakersfield, false);

  const offeringPause = capHandling.applyCapPause(campusPause.runtimeState, 'gardena', 'medical-assistant', 'Reached campus/program cap for Gardena Medical Assistant.', { testMode: false });
  assert.equal(offeringPause.changed, true);
  assert.equal(offeringPause.scope, 'campus-program');
  assert.equal(offeringPause.runtimeState.capPauses.offerings['gardena/medical-assistant'], false);

  const campaignPause = capHandling.applyCapPause(offeringPause.runtimeState, 'bakersfield', 'dental-assistant', 'Reached campaign/offer cap for x', { testMode: false });
  assert.equal(campaignPause.changed, false);
  assert.equal(campaignPause.scope, 'campaign');

  const testNoop = capHandling.applyCapPause(offeringPause.runtimeState, 'bakersfield', 'dental-assistant', 'Reached campus cap', { testMode: true });
  assert.equal(testNoop.changed, false);
});

test('publishRuntimeAvailability preserves durable pauses and retries on conflict', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uei-runtime-'));
  const storePath = path.join(tempDir, 'runtime.json');
  const initialState = {
    currentVersion: '2026-11',
    pendingVersion: null,
    versions: [{ id: '2026-11', effectiveDate: '2026-11-01T00:00:00-05:00', expiresAt: '2026-12-01T00:00:00-05:00', campuses: {}, offerings: {} }],
    manualPauses: { campuses: { oceanside: false }, offerings: { 'gardena/medical-assistant': false } },
    capPauses: { campuses: { bakersfield: false }, offerings: {} }
  };
  fs.writeFileSync(storePath, JSON.stringify({ __meta__: { etag: 'initial', updatedAt: new Date().toISOString() }, data: initialState }, null, 2) + '\n', 'utf8');

  let attempts = 0;
  const store = {
    async getWithMetadata(key) {
      if (key !== 'runtime-availability') return null;
      const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      return { data: raw.data, etag: raw.__meta__.etag };
    },
    async setJSON(key, value, options) {
      const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      if (options && options.onlyIfMatch && raw.__meta__.etag !== options.onlyIfMatch) {
        return { modified: false, etag: raw.__meta__.etag };
      }
      if (attempts === 0) {
        attempts += 1;
        return { modified: false, etag: raw.__meta__.etag };
      }
      const nextEtag = 'etag-' + Date.now();
      fs.writeFileSync(storePath, JSON.stringify({ __meta__: { etag: nextEtag, updatedAt: new Date().toISOString() }, data: value }, null, 2) + '\n', 'utf8');
      return { modified: true, etag: nextEtag };
    }
  };

  const imported = { id: '2026-12', effectiveDate: '2026-12-01T00:00:00-05:00', expiresAt: '2027-01-01T00:00:00-05:00', campuses: { ontario: true }, offerings: {} };
  const result = await runtimeAvailability.publishRuntimeAvailability({
    currentVersion: '2026-11',
    pendingVersion: '2026-12',
    versions: [initialState.versions[0], imported],
    manualPauses: { campuses: { oceanside: true }, offerings: {} },
    capPauses: { campuses: { bakersfield: true }, offerings: {} }
  }, { store, maxAttempts: 5 });

  assert.equal(result.status, 'ok');
  const durable = JSON.parse(fs.readFileSync(storePath, 'utf8')).data;
  assert.equal(durable.manualPauses.campuses.oceanside, false);
  assert.equal(durable.capPauses.campuses.bakersfield, false);
  assert.equal(durable.pendingVersion, '2026-12');
});

test('malformed stored runtime data is rejected and expired or future versions stay inactive', async () => {
  const broken = {
    async getWithMetadata() {
      return { data: '{not valid json', etag: 'bad' };
    }
  };
  const notValid = await runtimeAvailability.loadRuntimeAvailability({ store: broken, allowFileFallback: false });
  assert.equal(notValid.status, 'storage_error');

  const futureState = {
    currentVersion: '2099-01',
    pendingVersion: null,
    versions: [{ id: '2099-01', effectiveDate: '2099-01-01T00:00:00-05:00', expiresAt: '2099-02-01T00:00:00-05:00', campuses: {}, offerings: {} }],
    manualPauses: { campuses: {}, offerings: {} },
    capPauses: { campuses: {}, offerings: {} }
  };
  const futureRuntime = availability.resolveRuntime(campusConfig, futureState, new Date('2026-11-04T12:00:00-05:00'));
  assert.equal(futureRuntime.currentVersion, null);

  const expired = { versions: [{ id: '2026-11', effectiveDate: '2026-11-01T00:00:00-05:00', expiresAt: '2026-11-02T00:00:00-05:00', campuses: {}, offerings: {} }] };
  assert.equal(availability.effectiveAt(expired.versions[0], new Date('2026-11-05T12:00:00-05:00')), null);
});

test('import CLI publishes the intended version to an isolated mock store', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uei-import-'));
  const storePath = path.join(tempDir, 'runtime-store.json');
  const importFile = path.join(tempDir, 'approved-version.json');

  fs.writeFileSync(importFile, JSON.stringify({
    id: '2027-01',
    effectiveDate: '2027-01-01T00:00:00-05:00',
    expiresAt: '2027-02-01T00:00:00-05:00',
    campuses: {},
    offerings: {}
  }, null, 2) + '\n', 'utf8');

  const initialState = {
    currentVersion: '2026-11',
    pendingVersion: null,
    versions: [{ id: '2026-11', effectiveDate: '2026-11-01T00:00:00-05:00', expiresAt: '2026-12-01T00:00:00-05:00', campuses: {}, offerings: {} }],
    manualPauses: { campuses: { oceanside: false }, offerings: {} },
    capPauses: { campuses: {}, offerings: {} }
  };
  fs.writeFileSync(storePath, JSON.stringify({ __meta__: { etag: 'seed', updatedAt: new Date().toISOString() }, data: initialState }, null, 2) + '\n', 'utf8');

  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'import-availability.js'), '--file', importFile, '--publish', '--target', storePath], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const persisted = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  assert.equal(persisted.data.pendingVersion, '2027-01');
  assert.equal(persisted.data.manualPauses.campuses.oceanside, false);
  assert.equal(persisted.data.capPauses.campuses.bakersfield, undefined);
});
