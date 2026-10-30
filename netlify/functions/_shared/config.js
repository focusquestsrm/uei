'use strict';

const net = require('net');

// Endpoint from the LeadHoop posting specs (campaign 12213, "Posting URL"). The specification
// lists http://; the same host serves HTTPS, which is used so consumer data is encrypted in transit.
const LEADHOOP_ENDPOINT = 'https://back2learn-post.leadhoop.com/incoming/leads';
const MEDIA_TYPE = 'noncallcenter';
const FORM_PATHS = Object.freeze(['/', '/index.html']);
const VENDOR_TIMEOUT_MS = 8000;
const MAX_BODY_LENGTH = 20000;

function flag(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

// Reads the allowed site origin. HTTPS is required except for loopback hosts used in local testing.
function siteOrigin(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && loopback)) return parsed.origin;
  } catch (error) {
    return '';
  }
  return '';
}

// Returns { submissionEnabled, testMode, origin, campaignCode, ready }.
// ready is true only when external posting is fully configured; the page still builds and
// local mocked flows still run when it is false.
function readConfiguration(env) {
  const source = env || process.env;
  const submissionEnabled = flag(source.LEAD_SUBMISSION_ENABLED);
  const testMode = flag(source.LEAD_TEST_MODE);
  const origin = siteOrigin(source.SITE_URL);
  const campaignCode = String(source.LEADHOOP_CAMPAIGN_CODE || '').trim();
  const ready = submissionEnabled === true && testMode !== null && Boolean(origin) && /^[A-Za-z0-9_-]{8,64}$/.test(campaignCode);
  return { submissionEnabled: submissionEnabled === true, testMode: testMode !== false, origin, campaignCode, ready };
}

function validClientIp(value) {
  const text = String(value || '').trim();
  return net.isIP(text) !== 0 ? text : '';
}

module.exports = {
  FORM_PATHS, LEADHOOP_ENDPOINT, MAX_BODY_LENGTH, MEDIA_TYPE, VENDOR_TIMEOUT_MS,
  readConfiguration, siteOrigin, validClientIp
};
