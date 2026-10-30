'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleSubmission } = require('../netlify/functions/_shared/submit-lead-handler');
const idem = require('../netlify/functions/_shared/submission-idempotency');
const { ENV, SUCCESS, campusConfig, event, memoryStore, validBody, vendorFetch } = require('./helpers');

const OPEN_NOW = () => new Date('2026-10-27T16:00:00Z');

function run(body, options) {
  const settings = Object.assign({ env: ENV, store: memoryStore(), fetch: vendorFetch(SUCCESS), now: OPEN_NOW }, options);
  return handleSubmission(event(body), settings).then((result) => ({ result, settings, json: JSON.parse(result.body) }));
}

test('posts the exact vendor contract for a valid lead', async () => {
  const body = validBody({ utm_source: 'fb', subid2: 'fb.1.1.abc', subid3: 'fb.1.2.def', subid4: 'clickid' });
  const { result, settings, json } = await run(body);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(json, { outcome: 'accepted', testMode: true });
  const call = settings.fetch.calls[0];
  assert.equal(call.url, 'https://back2learn-post.leadhoop.com/incoming/leads');
  assert.equal(call.init.method, 'POST');
  assert.ok(!('authorization' in Object.fromEntries(Object.entries(call.init.headers).map(([k, v]) => [k.toLowerCase(), v]))));
  const p = call.params;
  const campus = campusConfig.campuses.find((c) => c.id === body.campus);
  const program = campusConfig.programs.find((c) => c.id === body.program);
  assert.equal(p.get('campaign_code'), ENV.LEADHOOP_CAMPAIGN_CODE);
  assert.equal(p.get('lead_education[campus_id]'), campus.leadHoopId);
  assert.equal(p.get('lead_education[program_id]'), program.leadHoopId);
  assert.equal(p.get('lead[phone1]'), '(555) 234-5678');
  assert.equal(p.get('lead[ip]'), '198.51.100.23');
  assert.equal(p.get('lead[signup_url]'), 'https://site.test/');
  assert.equal(p.get('lead[consent_url]'), 'https://site.test/');
  assert.equal(p.get('lead[test]'), 'true');
  assert.equal(p.get('lead[media_type]'), 'noncallcenter');
  assert.equal(p.get('lead_consent[tcpa_consent]'), 'Y');
  assert.equal(p.get('lead[service_leadid]'), body.leadIdToken);
  assert.equal(p.get('lead_education[education_level_id]'), '2274');
  assert.equal(p.get('lead_education[grad_year]'), '2015');
  assert.equal(p.get('lead_background[military_type]'), 'N');
  assert.equal(p.get('lead[gender]'), 'F');
  assert.equal(p.get('lead[age]'), '30');
  assert.equal(p.get('utm_source'), 'fb');
  assert.equal(p.get('subid2'), 'fb.1.1.abc');
  assert.equal(p.get('subid3'), 'fb.1.2.def');
  assert.equal(p.get('subid4'), 'clickid');
  assert.equal(p.get('subid'), null);
  assert.equal(p.has('lead_address[address2]'), false);
});

test('live mode sends lead[test]=false', async () => {
  const { settings, json } = await run(validBody(), { env: Object.assign({}, ENV, { LEAD_TEST_MODE: 'false' }) });
  assert.equal(settings.fetch.calls[0].params.get('lead[test]'), 'false');
  assert.equal(json.testMode, false);
});

test('blocked before reservation when not configured, origin wrong, or IP missing', async () => {
  let r = await run(validBody(), { env: Object.assign({}, ENV, { LEAD_SUBMISSION_ENABLED: 'false' }) });
  assert.equal(r.result.statusCode, 503);
  assert.equal(r.settings.fetch.calls.length, 0);
  r = await run(validBody(), { env: Object.assign({}, ENV, { LEADHOOP_CAMPAIGN_CODE: '' }) });
  assert.equal(r.result.statusCode, 503);
  const s = { env: ENV, store: memoryStore(), fetch: vendorFetch(SUCCESS), now: OPEN_NOW };
  assert.equal((await handleSubmission(event(validBody(), { headers: { origin: 'https://evil.test' } }), s)).statusCode, 403);
  assert.equal((await handleSubmission(event(validBody(), { headers: {} }), s)).statusCode, 403);
  assert.equal((await handleSubmission(event(validBody(), { clientIp: '' }), s)).statusCode, 400);
  assert.equal((await handleSubmission(event(validBody(), { clientIp: '::1; drop' }), s)).statusCode, 400);
  assert.equal((await handleSubmission(event(validBody(), { httpMethod: 'GET' }), s)).statusCode, 405);
  assert.equal(s.fetch.calls.length, 0);
  assert.equal(s.store.data.size, 0);
});

test('invalid input is rejected without posting or reserving', async () => {
  const campus = campusConfig.campuses.find((c) => c.id === 'bakersfield');
  const cases = {
    firstName: { firstName: 'A' },
    phone: { phone: '12345' },
    age: { age: '17' },
    gradYear: { gradYear: '2025' },
    gender: { gender: '' },
    military: { military: '' },
    education: { education: '1' },
    consent: { consent: '' },
    leadIdToken: { leadIdToken: 'abc' },
    state: { state: 'PR' },
    address: { address: 'Main Street' },
    zip: { campus: 'bakersfield', program: 'dental-assistant', zip: '10001' },
    selection: { campus: 'oceanside', program: 'hvac', zip: campusConfig.campuses.find((c) => c.id === 'oceanside').zips[0] },
    consentUrl: { consentUrl: 'https://evil.test/' },
    submissionId: { submissionId: 'short' }
  };
  for (const [name, override] of Object.entries(cases)) {
    const { result, settings, json } = await run(validBody(Object.assign({ campus: campus.id }, override)));
    assert.equal(result.statusCode, 400, name);
    assert.equal(json.outcome, 'validation_error', name);
    assert.equal(settings.fetch.calls.length, 0, name);
    assert.equal(settings.store.data.size, 0, name);
  }
  const r = await run(validBody({ firstName: 'x~invalid~' }));
  assert.equal(r.result.statusCode, 400);
});

test('consent URL must be the form page and drops the query string', async () => {
  const bad = await run(validBody({ consentUrl: 'https://site.test/privacy' }));
  assert.equal(bad.result.statusCode, 400);
  const good = await run(validBody({ consentUrl: 'https://site.test/index.html?a=1' }));
  assert.equal(good.settings.fetch.calls[0].params.get('lead[consent_url]'), 'https://site.test/index.html');
});

test('business and validation failures map to outcomes', async () => {
  const cases = [
    ['{"status":"failure","reason":"Advertiser rejected post."}', 'rejected', 200],
    ['{"status":"failure","reason":{"base":["Reached campaign/offer cap for x"]}}', 'rejected', 200],
    ['{"status":"failure","reason":{"lead[phone1]":["is invalid"]}}', 'invalid_request', 200],
    ['{"status":"failure","reason":{"base":["Duplicate lead"]}}', 'duplicate', 200],
    ['{"status":"failure","reason":{"campaign_code":["Campaign not available."]}}', 'unavailable', 502],
    ['not json', 'ambiguous', 502]
  ];
  for (const [text, outcome, status] of cases) {
    const { result, json } = await run(validBody(), { fetch: vendorFetch({ status: 200, body: text }) });
    assert.equal(json.outcome, outcome, text);
    assert.equal(result.statusCode, status, text);
  }
});

test('HTTP failure with a success-looking body is never accepted and never reposted', async () => {
  const body = validBody();
  const store = memoryStore();
  const fetch = vendorFetch({ status: 500, body: '{"status":"success"}' });
  const first = await run(body, { store, fetch });
  assert.equal(first.json.outcome, 'unavailable');
  assert.equal(first.result.statusCode, 502);
  const second = await run(body, { store, fetch });
  assert.equal(second.json.outcome, 'ambiguous');
  assert.equal(fetch.calls.length, 1);
});

test('network failure is ambiguous and blocks a retry', async () => {
  const body = validBody();
  const store = memoryStore();
  const fetch = vendorFetch(() => { throw new Error('network down'); });
  const first = await run(body, { store, fetch });
  assert.equal(first.json.outcome, 'ambiguous');
  const retry = await run(body, { store, fetch });
  assert.equal(retry.json.outcome, 'ambiguous');
  assert.equal(retry.json.replay, true);
  assert.equal(fetch.calls.length, 1);
});

test('a completed submission is replayed with its original outcome and no second post', async () => {
  const body = validBody();
  const store = memoryStore();
  const fetch = vendorFetch(SUCCESS);
  const first = await run(body, { store, fetch });
  const second = await run(body, { store, fetch });
  assert.equal(first.json.outcome, 'accepted');
  assert.deepEqual(second.json, { outcome: 'accepted', testMode: true, replay: true });
  assert.equal(fetch.calls.length, 1);
});

test('concurrent duplicates post once and the loser sees pending', async () => {
  const body = validBody();
  const store = memoryStore();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetch = vendorFetch(async () => { await gate; return { status: 200, text: async () => SUCCESS.body }; });
  const a = run(body, { store, fetch });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const b = await run(body, { store, fetch });
  assert.equal(b.result.statusCode, 202);
  assert.equal(b.json.outcome, 'pending');
  release();
  const done = await a;
  assert.equal(done.json.outcome, 'accepted');
  assert.equal(fetch.calls.length, 1);
});

test('reservation failure stops before posting', async () => {
  const store = { async setJSON() { throw new Error('store down'); }, async getWithMetadata() { return null; } };
  const { result, settings } = await run(validBody(), { store });
  assert.equal(result.statusCode, 503);
  assert.equal(settings.fetch.calls.length, 0);
});

test('idempotency requires a conditional write with an etag', async () => {
  const store = { async setJSON() { return { modified: true }; }, async getWithMetadata() { return null; } };
  const reservation = await idem.reserveSubmission(store, 'abcdefghijklmnop1234');
  assert.equal(reservation.owner, false);
  const lost = { async setJSON() { return { modified: false }; } };
  await assert.rejects(idem.completeSubmission(lost, { key: 'k', etag: 'e', record: {} }, 'completed', {}));
});

test('real network access is unreachable from tests', async () => {
  const { settings } = await run(validBody());
  assert.equal(settings.fetch.calls.length, 1);
  assert.ok(settings.fetch.calls[0].url.startsWith('https://back2learn-post.leadhoop.com/'));
});
