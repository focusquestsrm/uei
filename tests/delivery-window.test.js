'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isOpen, MESSAGE } = require('../netlify/functions/_shared/delivery-window');
const { handleSubmission } = require('../netlify/functions/_shared/submit-lead-handler');
const { ENV, SUCCESS, event, memoryStore, validBody, vendorFetch } = require('./helpers');

const at = (iso) => isOpen(new Date(iso));

test('Monday through Saturday 09:00 (inclusive) to 21:00 (exclusive) Eastern, EDT', () => {
  assert.equal(at('2026-10-26T12:59:59Z'), false); // Mon 08:59:59 EDT
  assert.equal(at('2026-10-26T13:00:00Z'), true); // Mon 09:00:00 EDT
  assert.equal(at('2026-10-27T00:59:59Z'), true); // Mon 20:59:59 EDT
  assert.equal(at('2026-10-27T01:00:00Z'), false); // Mon 21:00:00 EDT
  assert.equal(at('2026-10-31T13:00:00Z'), true); // Sat 09:00 EDT
  assert.equal(at('2026-11-01T00:59:59Z'), true); // Sat 20:59:59 EDT
  assert.equal(at('2026-11-01T01:00:00Z'), false); // Sat 21:00 EDT
});

test('Sunday is closed all day Eastern, including UTC instants that fall on Monday or Saturday', () => {
  assert.equal(at('2026-10-25T04:00:00Z'), false); // Sun 00:00 EDT
  assert.equal(at('2026-10-25T16:00:00Z'), false); // Sun noon EDT
  assert.equal(at('2026-10-26T03:59:59Z'), false); // Sun 23:59:59 EDT (Monday in UTC)
  assert.equal(at('2026-10-26T04:00:00Z'), false); // Mon 00:00 EDT
  assert.equal(at('2026-10-25T02:30:00Z'), false); // Sat 22:30 EDT (Sunday in UTC)
});

test('daylight saving: boundaries follow local time in EST and EDT', () => {
  assert.equal(at('2026-01-12T13:59:59Z'), false); // Mon 08:59:59 EST
  assert.equal(at('2026-01-12T14:00:00Z'), true); // Mon 09:00 EST
  assert.equal(at('2026-01-13T01:59:59Z'), true); // Mon 20:59:59 EST
  assert.equal(at('2026-01-13T02:00:00Z'), false); // Mon 21:00 EST
  // Spring forward Sunday 2026-03-08: Monday 09:00 is EDT (13:00Z), not 14:00Z.
  assert.equal(at('2026-03-09T12:59:59Z'), false);
  assert.equal(at('2026-03-09T13:00:00Z'), true);
  // Saturday before spring forward is still EST.
  assert.equal(at('2026-03-07T01:59:59Z'), true); // Fri 20:59:59 EST
  assert.equal(at('2026-03-08T01:59:59Z'), true); // Sat 20:59:59 EST
  assert.equal(at('2026-03-08T02:00:00Z'), false); // Sat 21:00 EST
});

test('daylight saving: fall back Sunday 2026-11-01 stays closed; Monday 09:00 is EST', () => {
  assert.equal(at('2026-11-01T15:00:00Z'), false);
  assert.equal(at('2026-11-02T13:59:59Z'), false); // Mon 08:59:59 EST
  assert.equal(at('2026-11-02T14:00:00Z'), true); // Mon 09:00 EST
});

test('invalid dates are treated as closed', () => {
  assert.equal(isOpen(new Date('nope')), false);
});

test('handler outside the window posts nothing, stores nothing, and tells the visitor', async () => {
  const settings = { env: ENV, store: memoryStore(), fetch: vendorFetch(SUCCESS), now: () => new Date('2026-10-25T16:00:00Z') };
  const result = await handleSubmission(event(validBody()), settings);
  const json = JSON.parse(result.body);
  assert.equal(result.statusCode, 503);
  assert.equal(json.outcome, 'closed');
  assert.equal(json.message, MESSAGE);
  assert.equal(settings.fetch.calls.length, 0);
  assert.equal(settings.store.data.size, 0);
});

test('handler inside the window still posts', async () => {
  const settings = { env: ENV, store: memoryStore(), fetch: vendorFetch(SUCCESS),   now: () => new Date('2026-10-27T00:59:59Z') };
    assert.equal((await handleSubmission(event(validBody()), settings)).statusCode, 200); // Mon 20:59:59 EDT
});

test('consent disclosure is the exact approved text with a working privacy link', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  const label = html.match(/<label for="leadid_tcpa_disclosure">([\s\S]*?)<\/label>/)[1];
  const link = label.match(/<a href="([^"]+)"([^>]*)>([^<]*)<\/a>/);
  assert.equal(link[1], 'https://www.uei.edu/privacy-policy-terms/');
  assert.match(link[2], /rel="noopener noreferrer"/);
  const text = label.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
  assert.equal(text, 'By clicking the button and submitting this form, I agree to UEI College and United Education Institute’s Privacy Policy and Terms, located at: https://www.uei.edu/privacy-policy-terms/. I also authorize and agree that a representative of UEI College and/or United Education Institute may contact me via email, telephone, text (Message & data rates may apply. Messages are recurring.), via automatic telephone dialing system and/or artificial or prerecorded voice, for any purpose at the number and email I provided above. I understand I do not need to provide such consent to receive any good or service and that I may opt out at any time.');
  const checkbox = html.match(/<input[^>]*id="leadid_tcpa_disclosure"[^>]*>/)[0];
  assert.match(checkbox, /required/);
  assert.doesNotMatch(checkbox, /checked/);
  assert.match(html, /id="leadid_token"/);
});
