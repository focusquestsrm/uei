(function (root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.UEI_PHONE = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const MESSAGE = 'Phone number is not valid';
  // Optional leading +, digits, and common separators only. Anything else is invalid.
  const ALLOWED = /^\+?[\d\s().-]+$/;

  // Returns the exact 10-digit national number, or null when the value is not valid.
  // A national number cannot itself begin with 1, so a stray leading 1 is never trimmed twice.
  function normalize(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!ALLOWED.test(text)) return null;
    const plus = text.charAt(0) === '+';
    const digits = text.replace(/\D/g, '');
    let national = null;
    if (digits.length === 10 && !plus) national = digits;
    else if (digits.length === 11 && digits.charAt(0) === '1') national = digits.slice(1);
    return national && national.charAt(0) !== '1' ? national : null;
  }

  // The LeadHoop specification shows the phone pattern as (917) 478-3878.
  function formatForVendor(national) {
    return /^\d{10}$/.test(national) ? '(' + national.slice(0, 3) + ') ' + national.slice(3, 6) + '-' + national.slice(6) : null;
  }

  return Object.freeze({ MESSAGE, normalize, formatForVendor });
});
