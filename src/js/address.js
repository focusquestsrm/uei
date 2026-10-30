(function (root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.UEI_ADDRESS = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Manual format checks adapted from the South University address validation
  // (focusquestsrm/southuniversity@2701d70). They check shape only and do not
  // prove that an address exists.
  const MESSAGES = Object.freeze({
    address: 'Please enter a valid street address',
    address2: 'Apartment, suite, or floor may only contain letters, numbers, spaces, and . , # / \' -',
    city: 'Please enter a valid city',
    state: 'Please select your state.',
    zip: 'Please enter a valid 5-digit ZIP code'
  });

  // 50 states and DC. The campaign rejects AA, AE, AP, PR, VI, AS, GU, and MP.
  const STATE_CODES = Object.freeze([
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY',
    'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH',
    'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
  ]);

  const URL_OR_EMAIL = /https?:\/\/|www\.|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/i;

  function normalizeValue(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  }

  function isValidStreetAddress(value) {
    const text = normalizeValue(value);
    if (text.length < 4 || text.length > 100) return false;
    if (!/^[A-Za-z0-9 .,#/'-]+$/.test(text)) return false;
    if (/[.,#/'-]{3,}/.test(text) || URL_OR_EMAIL.test(text)) return false;
    // The posting specification requires a numeral, a letter, and a space.
    if (!/[A-Za-z]/.test(text) || !/[0-9]/.test(text) || text.indexOf(' ') === -1) return false;
    return true;
  }

  function isValidAddress2(value) {
    const text = normalizeValue(value);
    if (!text) return true;
    return text.length <= 50 && /^[A-Za-z0-9 .,#/'-]+$/.test(text) && !/[.,#/'-]{3,}/.test(text) && !URL_OR_EMAIL.test(text);
  }

  function isValidCity(value) {
    const text = normalizeValue(value);
    if (text.length < 2 || text.length > 60) return false;
    if (!/^[A-Za-z][A-Za-z .'-]*$/.test(text)) return false;
    if (/[.'-]{2,}/.test(text) || URL_OR_EMAIL.test(text)) return false;
    return true;
  }

  function isValidStateCode(value) {
    return STATE_CODES.indexOf(normalizeValue(value).toUpperCase()) !== -1;
  }

  // ZIP codes stay strings so leading zeros are preserved.
  function isValidZipCode(value) {
    return typeof value === 'string' && /^\d{5}$/.test(value.trim());
  }

  return Object.freeze({
    MESSAGES, STATE_CODES, normalizeValue,
    isValidStreetAddress, isValidAddress2, isValidCity, isValidStateCode, isValidZipCode
  });
});
