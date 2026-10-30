'use strict';

// Classifies a LeadHoop posting response. HTTP status and the documented JSON body are
// evaluated together: a non-2xx response is never an acceptance, even if the body says success.
//
// kind values:
//   accepted        2xx + {"status":"success"}
//   rejected        2xx + {"status":"failure"} for a business reason (caps, advertiser, verification)
//   invalid_request 2xx + failure naming a submitted field
//   duplicate       2xx + failure describing a duplicate lead
//   configuration   2xx + failure naming campaign_code
//   http_failure    non-2xx
//   ambiguous       2xx with a missing, unreadable, or unrecognized body

function collectText(value, output, depth) {
  if (depth > 5 || value === null || value === undefined) return;
  if (typeof value === 'string' || typeof value === 'number') output.push(String(value));
  else if (Array.isArray(value)) value.forEach(function (entry) { collectText(entry, output, depth + 1); });
  else if (typeof value === 'object') Object.values(value).forEach(function (entry) { collectText(entry, output, depth + 1); });
}

function failureKind(reason) {
  const texts = [];
  collectText(reason, texts, 0);
  if (texts.some(function (text) { return /duplicate/i.test(text); })) return 'duplicate';
  if (reason && typeof reason === 'object' && !Array.isArray(reason)) {
    const fields = Object.keys(reason).filter(function (name) { return name !== 'base'; });
    if (fields.indexOf('campaign_code') !== -1) return 'configuration';
    if (fields.length > 0) return 'invalid_request';
  }
  return 'rejected';
}

function classify(httpStatus, bodyText) {
  if (!Number.isInteger(httpStatus) || httpStatus < 200 || httpStatus > 299) return { kind: 'http_failure' };
  let result = null;
  try {
    result = JSON.parse(String(bodyText || ''));
  } catch (error) {
    result = null;
  }
  if (result && typeof result === 'object' && !Array.isArray(result) && typeof result.status === 'string') {
    const status = result.status.trim().toLowerCase();
    if (status === 'success') return { kind: 'accepted' };
    if (status === 'failure') return { kind: failureKind(result.reason) };
    return { kind: 'ambiguous' };
  }
  // The specification's own phone-failure example is not valid JSON; still recognize a stated failure.
  if (/"status"\s*:\s*"failure"/i.test(String(bodyText || ''))) {
    return { kind: /"reason"\s*:\s*"?\w+"?\s*:\s*\[/.test(String(bodyText)) ? 'invalid_request' : 'rejected' };
  }
  return { kind: 'ambiguous' };
}

module.exports = { classify };
