'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const phone = require('../src/js/phone');
const address = require('../src/js/address');
const rules = require('../src/js/rules');
const catalog = require('../src/js/catalog');
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
  assert.ok(rules.isValidGender('M') && !rules.isValidGender('X'));
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
