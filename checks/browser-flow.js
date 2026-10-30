'use strict';

// Full mocked browser flow. Everything external is blocked or stubbed; no real lead is sent.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright-core');
const idem = require('../netlify/functions/_shared/submission-idempotency');

const SRC = path.join(__dirname, '..', 'src');
const OUT = path.join(__dirname, 'output');
const TOKEN = '0123ABCD-4567-89ab-cdef-0123456789AB';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

const state = { now: new Date('2026-10-27T16:00:00Z'), vendor: null, calls: [], store: null, testMode: true, tokenEnabled: true, blocked: [] };

function memoryStore() {
  const data = new Map();
  let counter = 0;
  return {
    async setJSON(key, value, options) {
      const existing = data.get(key);
      if (options && options.onlyIfNew && existing) return { modified: false };
      if (options && options.onlyIfMatch && (!existing || existing.etag !== options.onlyIfMatch)) return { modified: false };
      counter += 1;
      data.set(key, { value: JSON.parse(JSON.stringify(value)), etag: 'e' + counter });
      return { modified: true, etag: 'e' + counter };
    },
    async getWithMetadata(key) {
      const entry = data.get(key);
      return entry ? { data: JSON.parse(JSON.stringify(entry.value)), etag: entry.etag } : null;
    }
  };
}

async function startServer() {
  const { handleRequest } = await import('../netlify/functions/_shared/modern-wrapper.mjs');
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/.netlify/functions/submit-lead') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const origin = 'http://127.0.0.1:' + server.address().port;
      const request = new Request(origin + url.pathname, {
        method: req.method,
        headers: Object.assign({}, req.headers, { 'x-nf-client-connection-ip': '198.51.100.77' }),
        body: req.method === 'POST' ? Buffer.concat(chunks) : undefined
      });
      const response = await handleRequest(request, { requestId: 'local' }, {
        env: {
          LEAD_SUBMISSION_ENABLED: 'true',
          LEAD_TEST_MODE: String(state.testMode),
          SITE_URL: origin,
          LEADHOOP_CAMPAIGN_CODE: 'DUMMYCAMPAIGNCODE123'
        },
        store: state.store,
        now: () => state.now,
        fetch: async (vendorUrl, init) => {
          state.calls.push({ url: vendorUrl, params: new URLSearchParams(init.body) });
          if (state.vendor.delay) await new Promise((resolve) => setTimeout(resolve, state.vendor.delay));
          return { status: state.vendor.status, text: async () => state.vendor.body };
        }
      });
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    let file = path.join(SRC, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(SRC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

let failures = 0;
function ok(condition, label) {
  console.log((condition ? 'PASS ' : 'FAIL ') + label);
  if (!condition) failures += 1;
}

async function newPage(browser, origin, profile) {
  const context = await browser.newContext(profile);
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(origin)) return route.continue();
    if (url.includes('create.lidstatic.com/campaign/')) {
      const body = state.tokenEnabled ? "document.getElementById('leadid_token').value='" + TOKEN + "';" : '';
      return route.fulfill({ status: 200, contentType: 'text/javascript', body });
    }
    if (url.includes('connect.facebook.net')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    state.blocked.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__fb = JSON.parse(sessionStorage.getItem('__fb') || '[]');
    const fbq = function () {
      window.__fb.push(Array.prototype.slice.call(arguments));
      sessionStorage.setItem('__fb', JSON.stringify(window.__fb));
    };
    fbq.queue = [];
    window.fbq = fbq;
  });
  return { context, page };
}

async function fill(page, overrides) {
  const v = Object.assign({
    campus: 'bakersfield', program: 'dental-assistant', education: '2274|high-school-diploma', gradYear: '2015', age: '30',
    gender: 'F', military: 'N', address: '123 Main St', address2: 'Apt 4', city: 'Bakersfield', state: 'CA', zip: null,
    firstName: 'Testy', lastName: 'Person', email: 'testy@example.com', phone: '(555) 234-5678', startDate: 'Immediately'
  }, overrides);
  if (!v.zip) v.zip = await page.evaluate((id) => window.UEI_CHOICES.campuses.find((c) => c.id === id).zips[0], v.campus);
  await page.selectOption('#campus', v.campus);
  await page.selectOption('#program', v.program);
  await page.click('[data-step="1"] [data-next]');
  for (const id of ['education', 'gradYear', 'gender', 'military', 'state']) await page.selectOption('#' + id, v[id]);
  for (const id of ['age', 'address', 'address2', 'city', 'zip']) await page.fill('#' + id, v[id]);
  await page.click('[data-step="2"] [data-next]');
  for (const id of ['firstName', 'lastName', 'email', 'phone']) await page.fill('#' + id, v[id]);
  await page.selectOption('#startDate', v.startDate);
  await page.check('#leadid_tcpa_disclosure');
  return v;
}

function reset(vendor, testMode) {
  state.vendor = vendor || { status: 200, body: '{"status":"success","testing":true}' };
  state.calls = [];
  state.store = memoryStore();
  state.testMode = testMode !== false;
  state.tokenEnabled = true;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const executablePath = CHROME_PATHS.find((candidate) => fs.existsSync(candidate));
  if (!executablePath) throw new Error('No Chrome or Edge executable found.');
  idem.setStoreFactoryForTests(() => state.store);
  const server = await startServer();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath, headless: true });
  const profiles = {
    desktop: { viewport: { width: 1280, height: 900 } },
    mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
  };

  for (const [name, profile] of Object.entries(profiles)) {
    // Happy path. Desktop runs in test mode (no Lead); mobile in live mode (one Lead).
    const live = name === 'mobile';
    reset(null, !live);
    let { context, page } = await newPage(browser, origin, profile);
    await page.goto(origin + '/?utm_source=meta&utm_campaign=c1&fbclid=abc123');
    await page.waitForFunction(() => document.getElementById('leadid_token').value.length === 36);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), name + ': no horizontal overflow');
    await page.screenshot({ path: path.join(OUT, name + '-landing.png'), fullPage: true });
    const campuses = await page.$$eval('#campus option', (o) => o.map((e) => e.value).filter(Boolean));
    ok(!campuses.includes('oceanside') && campuses.length === 6, name + ': paused Oceanside absent, 6 campuses offered');
    await page.selectOption('#campus', 'gardena');
    const gardenaPrograms = await page.$$eval('#program option', (o) => o.map((e) => e.value).filter(Boolean));
    ok(JSON.stringify(gardenaPrograms) === JSON.stringify(['electrician-technician', 'hvac']), name + ': Gardena offers only Electrician and HVAC');
    await page.selectOption('#campus', 'bakersfield');
    await page.selectOption('#program', 'dental-assistant');
    await page.selectOption('#campus', 'gardena');
    ok((await page.inputValue('#program')) === '', name + ': campus change clears unavailable program');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('leadid_token').value.length === 36);
    await fill(page, {});
    await page.screenshot({ path: path.join(OUT, name + '-form-final-step.png') });
    await page.click('#submit-button');
    await page.waitForURL('**/thank-you.html', { timeout: 10000 });
    ok(state.calls.length === 1, name + ': exactly one vendor post');
    const p = state.calls[0].params;
    ok(p.get('lead[test]') === String(!live), name + ': lead[test]=' + String(!live));
    ok(p.get('lead_education[campus_id]') === '30479' && p.get('lead_education[program_id]') === '226133', name + ': campus and program routing IDs');
    ok(p.get('lead[phone1]') === '(555) 234-5678' && p.get('lead[service_leadid]') === TOKEN && p.get('lead_consent[tcpa_consent]') === 'Y', name + ': phone, token, consent');
    ok(p.get('utm_source') === 'meta' && p.get('subid4') === 'abc123' && /^fb\.1\.\d+\.abc123$/.test(p.get('subid2')), name + ': attribution passthrough');
    ok(p.get('lead[consent_url]') === origin + '/' && p.get('lead[signup_url]') === origin + '/', name + ': consent and signup URLs');
    ok(!(await page.evaluate(() => document.body.textContent)).includes('testy@example.com'), name + ': thank-you page shows no consumer data');
    ok((await page.locator('meta[name=robots]').getAttribute('content')).includes('noindex'), name + ': thank-you is noindex');
    await page.screenshot({ path: path.join(OUT, name + '-thank-you.png') });
    await context.close();
    // The Lead event lives on the pre-navigation page; verify it separately via a fresh live run below.

    if (live) {
      reset(null, false);
      ({ context, page } = await newPage(browser, origin, profile));
      await page.goto(origin + '/');
      await page.waitForFunction(() => document.getElementById('leadid_token').value.length === 36);
      await fill(page, {});
      await page.click('#submit-button');
      await page.waitForFunction(() => window.__fb.some((c) => c[1] === 'Lead'), null, { timeout: 5000 });
      const leads = await page.evaluate(() => window.__fb.filter((c) => c[1] === 'Lead').length);
      ok(leads === 1, name + ': live accepted lead fires exactly one Meta Lead');
      await page.waitForURL('**/thank-you.html', { timeout: 10000 });
      await context.close();
    }

    // Test mode never fires Lead.
    reset(null, true);
    ({ context, page } = await newPage(browser, origin, profile));
    await page.goto(origin + '/');
    await page.waitForFunction(() => document.getElementById('leadid_token').value.length === 36);
    await fill(page, {});
    await page.evaluate(() => { window.__nav = true; });
    await page.click('#submit-button');
    await page.waitForURL('**/thank-you.html', { timeout: 10000 });
    ok(!(await page.evaluate(() => window.__fb.some((c) => c[1] === 'Lead'))), name + ': test-mode submission fires no Meta Lead');
    await context.close();

    // Business rejection reaches thank-you with no Lead.
    reset({ status: 200, body: '{"status":"failure","reason":{"base":["Reached campaign/offer cap for x"]}}' }, false);
    ({ context, page } = await newPage(browser, origin, profile));
    await page.goto(origin + '/');
    await page.waitForFunction(() => document.getElementById('leadid_token').value.length === 36);
    await fill(page, {});
    await page.click('#submit-button');
    await page.waitForURL('**/thank-you.html', { timeout: 10000 });
    ok(state.calls.length === 1 && !(await page.evaluate(() => window.__fb.some((c) => c[1] === 'Lead'))), name + ': rejected lead posted once, routed to thank-you, no Meta Lead');
    await context.close();
  }

  // Client-side and failure scenarios on desktop.
  const profile = profiles.desktop;
  reset();
  let { context, page } = await newPage(browser, origin, profile);
  await page.goto(origin + '/');
  await page.waitForFunction(() => document.getElementById('leadid_token').value.length === 36);
  await page.click('[data-step="1"] [data-next]');
  ok((await page.textContent('[data-error="campus"]')).includes('select a campus'), 'validation: campus required');
  await page.selectOption('#campus', 'bakersfield');
  await page.selectOption('#program', 'dental-assistant');
  await page.click('[data-step="1"] [data-next]');
  await page.fill('#zip', '10001');
  await page.fill('#address', 'Main Street');
  await page.click('[data-step="2"] [data-next]');
  ok(await page.isVisible('[data-step="2"]'), 'validation: step 2 blocks invalid data');
  ok((await page.textContent('[data-error="address"]')).length > 0 && (await page.textContent('[data-error="zip"]')).includes('ZIP'), 'validation: address and ZIP errors shown');
  await page.fill('#zip', '93301');
  await page.click('[data-step="2"] [data-next]');
  ok((await page.textContent('[data-error="zip"]')) === '', 'validation: in-area ZIP clears the ZIP error');
  await context.close();

  // ZIP outside the selected campus.
  reset();
  ({ context, page } = await newPage(browser, origin, profile));
  page.setDefaultTimeout(1500);
  await page.goto(origin + '/');
  await fill(page, { zip: '90210' }).catch(() => {});
  page.setDefaultTimeout(30000);
  ok((await page.textContent('[data-error="zip"]')).includes('outside the area'), 'validation: ZIP outside campus area blocked');
  ok(state.calls.length === 0, 'validation: no vendor post for out-of-area ZIP');
  await context.close();

  // Exact consent text and link; checkbox unchecked.
  reset();
  ({ context, page } = await newPage(browser, origin, profile));
  await page.goto(origin + '/');
  const consentText = await page.textContent('label[for="leadid_tcpa_disclosure"]');
  ok(consentText.startsWith('By clicking the button and submitting this form, I agree to UEI College and United Education Institute’s Privacy Policy and Terms, located at: https://www.uei.edu/privacy-policy-terms/. I also authorize') && consentText.endsWith('I may opt out at any time.'), 'consent: exact approved text rendered');
  ok((await page.getAttribute('label[for="leadid_tcpa_disclosure"] a', 'href')) === 'https://www.uei.edu/privacy-policy-terms/', 'consent: privacy link href');
  ok(!(await page.isChecked('#leadid_tcpa_disclosure')), 'consent: checkbox unchecked');
  await context.close();

  // Outside the delivery window (Sunday, Eastern): message shown, nothing posted, no navigation.
  for (const [name, p] of Object.entries(profiles)) {
    reset();
    state.now = new Date('2026-10-25T16:00:00Z');
    ({ context, page } = await newPage(browser, origin, p));
    await page.goto(origin + '/');
    await page.waitForFunction(() => document.getElementById('leadid_token').value.length === 36);
    await fill(page, {});
    await page.click('#submit-button');
    await page.waitForSelector('#form-status:not([hidden])');
    ok((await page.textContent('#form-status')).includes('Monday through Saturday') && state.calls.length === 0 && page.url().endsWith('/') && (await state.store.getWithMetadata('x')) === null, 'closed window (' + name + '): message, no post, stays on form');
    await context.close();
    state.now = new Date('2026-10-27T16:00:00Z');
  }

  // Missing Jornaya token blocks submit.
  reset();
  state.tokenEnabled = false;
  ({ context, page } = await newPage(browser, origin, profile));
  await page.goto(origin + '/');
  await fill(page, {});
  await page.click('#submit-button');
  await page.waitForSelector('#form-status:not([hidden])');
  ok(state.calls.length === 0 && (await page.textContent('#form-status')).includes('Verification'), 'missing Jornaya token blocks submission');
  await context.close();

  // HTTP failure with a success-looking body, then retry; double click posts once.
  reset({ status: 500, body: '{"status":"success"}', delay: 150 }, false);
  ({ context, page } = await newPage(browser, origin, profile));
  await page.goto(origin + '/');
  await page.waitForFunction(() => document.getElementById('leadid_token').value.length === 36);
  await fill(page, {});
  await page.dblclick('#submit-button');
  await page.waitForSelector('#form-status:not([hidden])');
  ok(state.calls.length === 1, 'double submit posts once');
  ok(page.url().endsWith('/') && !(await page.evaluate(() => window.__fb.some((c) => c[1] === 'Lead'))), 'HTTP failure stays on form, no Lead');
  await page.click('#submit-button');
  await page.waitForTimeout(400);
  ok(state.calls.length === 1, 'retry after ambiguous failure does not repost');
  await context.close();

  // Invalid-request response clears the id and stays on the form.
  reset({ status: 200, body: '{"status":"failure","reason":{"lead[phone1]":["is invalid"]}}' }, false);
  ({ context, page } = await newPage(browser, origin, profile));
  await page.goto(origin + '/');
  await page.waitForFunction(() => document.getElementById('leadid_token').value.length === 36);
  await fill(page, {});
  await page.click('#submit-button');
  await page.waitForSelector('#form-status:not([hidden])');
  ok(page.url().endsWith('/') && (await page.textContent('#form-status')).includes('review'), 'vendor field failure keeps user on form');
  await context.close();

  ok(state.blocked.every((url) => !url.startsWith('http://127.0.0.1')), 'no local request was blocked');
  const external = [...new Set(state.blocked.map((url) => new URL(url).host))];
  console.log('Blocked external hosts (never contacted): ' + (external.join(', ') || 'none'));
  await browser.close();
  server.close();
  console.log(failures === 0 ? 'ALL BROWSER CHECKS PASSED' : failures + ' BROWSER CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
