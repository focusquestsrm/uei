'use strict';

const catalogModule = require('../../../src/js/catalog');
const address = require('../../../src/js/address');
const phone = require('../../../src/js/phone');
const rules = require('../../../src/js/rules');
const campusConfig = require('../../../config/campus-programs.json');
const { classify } = require('./leadhoop-response');
const { FORM_PATHS, LEADHOOP_ENDPOINT, MAX_BODY_LENGTH, MEDIA_TYPE, VENDOR_TIMEOUT_MS, readConfiguration, validClientIp } = require('./config');
const {
  completeSubmission,
  getSubmissionStore,
  reserveSubmission,
  responseForDuplicate,
  validSubmissionId
} = require('./submission-idempotency');

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const ATTRIBUTION_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'subid2', 'subid3', 'subid4'];
const ATTRIBUTION_PATTERN = /^[A-Za-z0-9 _.,:;|+~%()/-]{1,200}$/;

function reply(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

function log(event, fields) {
  // Privacy-safe: never log consumer values, tokens, the campaign code, or vendor bodies.
  console.log(JSON.stringify(Object.assign({ event }, fields)));
}

function header(event, name) {
  const headers = event.headers || {};
  const key = Object.keys(headers).find(function (entry) { return entry.toLowerCase() === name; });
  return key ? String(headers[key]) : '';
}

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function originAllowed(event, origin) {
  return header(event, 'origin') === origin;
}

function consentUrl(value, origin) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.origin === origin && FORM_PATHS.indexOf(parsed.pathname) !== -1) return origin + parsed.pathname;
  } catch (error) {
    return '';
  }
  return '';
}

// Returns { errors, value } where value holds normalized, validated fields.
function validate(body, configuration) {
  const errors = {};
  const check = function (name, ok) { if (!ok) errors[name] = true; };
  const value = {};

  value.firstName = str(body.firstName);
  value.lastName = str(body.lastName);
  check('firstName', rules.isValidName(value.firstName));
  check('lastName', rules.isValidName(value.lastName));

  value.email = str(body.email);
  check('email', rules.isValidEmail(value.email));

  const national = phone.normalize(str(body.phone));
  value.phone = national ? phone.formatForVendor(national) : null;
  check('phone', Boolean(value.phone));

  value.age = str(body.age);
  check('age', rules.isValidAge(value.age));
  value.gender = str(body.gender);
  check('gender', rules.isValidGender(value.gender));
  value.military = str(body.military);
  check('military', rules.isValidMilitary(value.military));
  value.gradYear = str(body.gradYear);
  check('gradYear', rules.isValidGradYear(value.gradYear));
  value.education = str(body.education);
  check('education', rules.isValidEducation(value.education));
  value.startDate = str(body.startDate);
  check('startDate', rules.isValidStartDate(value.startDate));

  value.address = address.normalizeValue(body.address);
  value.address2 = address.normalizeValue(body.address2);
  value.city = address.normalizeValue(body.city);
  value.state = str(body.state).toUpperCase();
  value.zip = str(body.zip);
  check('address', address.isValidStreetAddress(value.address));
  check('address2', address.isValidAddress2(value.address2));
  check('city', address.isValidCity(value.city));
  check('state', address.isValidStateCode(value.state));
  check('zip', address.isValidZipCode(value.zip));

  check('consent', body.consent === 'Y');
  value.leadId = str(body.leadIdToken);
  check('leadIdToken', rules.isValidLeadIdToken(value.leadId));

  const selection = catalogModule.resolveSelection(campusConfig, str(body.campus), str(body.program), value.zip);
  if (!selection.ok) {
    errors[selection.reason === 'zip' ? 'zip' : 'selection'] = true;
  } else {
    value.campus = selection.campus;
    value.program = selection.program;
  }

  value.consentUrl = consentUrl(body.consentUrl, configuration.origin);
  check('consentUrl', Boolean(value.consentUrl));

  value.attribution = {};
  ATTRIBUTION_FIELDS.forEach(function (name) {
    const text = str(body[name]);
    if (text && ATTRIBUTION_PATTERN.test(text)) value.attribution[name] = text;
  });

  return { errors, value };
}

function buildVendorBody(value, configuration, clientIp) {
  const params = new URLSearchParams();
  const add = function (name, content) { if (content !== '' && content !== undefined && content !== null) params.append(name, content); };
  add('campaign_code', configuration.campaignCode);
  add('lead[firstname]', value.firstName);
  add('lead[lastname]', value.lastName);
  add('lead_address[address]', value.address);
  add('lead_address[address2]', value.address2);
  add('lead_address[city]', value.city);
  add('lead_address[state]', value.state);
  add('lead_address[zip]', value.zip);
  add('lead[email]', value.email);
  add('lead[phone1]', value.phone);
  add('lead[age]', value.age);
  add('lead[gender]', value.gender);
  add('lead_education[grad_year]', value.gradYear);
  add('lead_background[military_type]', value.military);
  add('lead_education[education_level_id]', value.education);
  add('lead_education[program_id]', value.program.leadHoopId);
  add('lead_education[campus_id]', value.campus.leadHoopId);
  add('lead_education[start_date]', value.startDate);
  add('lead_consent[tcpa_consent]', 'Y');
  add('lead[service_leadid]', value.leadId);
  add('lead[ip]', clientIp);
  add('lead[signup_url]', configuration.origin + '/');
  add('lead[consent_url]', value.consentUrl);
  add('lead[test]', configuration.testMode ? 'true' : 'false');
  add('lead[media_type]', MEDIA_TYPE);
  ATTRIBUTION_FIELDS.forEach(function (name) { add(name, value.attribution[name]); });
  return params.toString();
}

async function postToVendor(fetchImpl, body) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, VENDOR_TIMEOUT_MS);
  try {
    const response = await fetchImpl(LEADHOOP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      signal: controller.signal
    });
    const text = await response.text();
    return { sent: true, status: response.status, text };
  } catch (error) {
    return { sent: true, failed: true };
  } finally {
    clearTimeout(timer);
  }
}

function publicOutcome(kind) {
  if (kind === 'accepted' || kind === 'rejected' || kind === 'duplicate' || kind === 'invalid_request') return kind;
  if (kind === 'ambiguous') return 'ambiguous';
  return 'unavailable';
}

async function handleSubmission(event, options) {
  const settings = options || {};
  const env = settings.env || process.env;
  const fetchImpl = settings.fetch || globalThis.fetch;

  if (event.httpMethod !== 'POST') return reply(405, { outcome: 'validation_error' });

  const configuration = readConfiguration(env);
  if (!configuration.ready) {
    log('submission_unavailable', { reason: 'not_configured' });
    return reply(503, { outcome: 'unavailable', retryable: true });
  }
  if (!originAllowed(event, configuration.origin)) return reply(403, { outcome: 'validation_error' });

  const clientIp = validClientIp(event.clientIp);
  if (!clientIp) {
    log('submission_unavailable', { reason: 'no_client_ip' });
    return reply(400, { outcome: 'validation_error' });
  }

  const raw = String(event.body || '');
  if (raw.length > MAX_BODY_LENGTH) return reply(413, { outcome: 'validation_error' });
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch (error) {
    body = null;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { outcome: 'validation_error' });
  if (!validSubmissionId(body.submissionId)) return reply(400, { outcome: 'validation_error', fields: ['submissionId'] });
  if (Object.values(body).some(function (entry) { return typeof entry === 'string' && /~invalid~/i.test(entry); })) {
    return reply(400, { outcome: 'validation_error' });
  }

  const checked = validate(body, configuration);
  const fields = Object.keys(checked.errors);
  if (fields.length > 0) {
    log('validation_failed', { fields });
    return reply(400, { outcome: 'validation_error', fields });
  }

  let store = null;
  let reservation = null;
  try {
    store = settings.store || getSubmissionStore();
    reservation = await reserveSubmission(store, body.submissionId, settings.requestId);
  } catch (error) {
    log('reservation_failed', { error: error && error.name });
    return reply(503, { outcome: 'unavailable', retryable: true });
  }
  if (!reservation.owner) {
    const duplicate = responseForDuplicate(reservation.record);
    log('duplicate_submission', { state: reservation.record && reservation.record.state });
    return reply(duplicate.statusCode, duplicate.body);
  }

  const vendor = await postToVendor(fetchImpl, buildVendorBody(checked.value, configuration, clientIp));
  const classification = vendor.failed ? { kind: 'ambiguous' } : classify(vendor.status, vendor.text);
  const outcome = publicOutcome(classification.kind);
  const response = { outcome, testMode: configuration.testMode };
  const definitive = ['accepted', 'rejected', 'duplicate', 'invalid_request'].indexOf(outcome) !== -1;

  log('vendor_result', {
    outcome,
    kind: classification.kind,
    httpStatus: vendor.failed ? 'network' : vendor.status,
    testMode: configuration.testMode,
    campus: checked.value.campus.id
  });

  try {
    await completeSubmission(store, reservation, definitive ? 'completed' : 'ambiguous', response);
  } catch (error) {
    log('completion_failed', { error: error && error.name });
  }

  // Ambiguous or unavailable outcomes are never retried automatically; the stored state blocks reposting.
  return reply(definitive ? 200 : 502, definitive ? response : Object.assign({ retryable: false }, response));
}

module.exports = { handleSubmission, buildVendorBody, validate };
