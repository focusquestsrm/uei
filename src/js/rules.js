(function (root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.UEI_RULES = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Campaign-specific limits from the LeadHoop posting specs (Field Validations).
  // These take precedence over the broader generic value lists in the spec.
  const MIN_AGE = 18;
  const MAX_AGE = 99;
  const MIN_GRAD_YEAR = 1998;
  const MAX_GRAD_YEAR = 2024;

  const GENDERS = Object.freeze([
    { value: 'M', label: 'Male' },
    { value: 'F', label: 'Female' }
  ]);

  // Y means active duty; N covers every other affiliation listed by the spec.
  const MILITARY = Object.freeze([
    { value: 'N', label: 'No' },
    { value: 'Y', label: 'Yes' }
  ]);

  // Education IDs 2274-2279. Several display choices share one vendor value.
  const EDUCATION_LEVELS = Object.freeze([
    { id: 'high-school-diploma', value: '2274', label: 'High School Diploma' },
    { id: 'ged', value: '2274', label: 'GED' },
    { id: 'some-college-1-29', value: '2275', label: 'Some College (1-29 credits)' },
    { id: 'some-college-30-59', value: '2275', label: 'Some College (30-59 credits)' },
    { id: 'some-college-60-plus', value: '2275', label: 'Some College (60+ credits)' },
    { id: 'associates', value: '2276', label: 'Associates Degree' },
    { id: 'bachelors', value: '2277', label: 'Bachelors Degree' },
    { id: 'masters', value: '2278', label: 'Masters Degree' },
    { id: 'doctorate', value: '2279', label: 'Doctorates/PhD' }
  ]);

  const START_DATES = Object.freeze(['Immediately', '1-3 Months', '4-6 Months', '7-12 Months', 'More than 1 Year', 'Not Sure']);

  const EDUCATION_VALUES = Object.freeze(['2274', '2275', '2276', '2277', '2278', '2279']);

  function gradYears() {
    const years = [];
    for (let year = MAX_GRAD_YEAR; year >= MIN_GRAD_YEAR; year -= 1) years.push(String(year));
    return years;
  }

  function isValidGradYear(value) {
    return /^\d{4}$/.test(String(value)) && Number(value) >= MIN_GRAD_YEAR && Number(value) <= MAX_GRAD_YEAR;
  }

  function isValidAge(value) {
    return /^\d{1,3}$/.test(String(value)) && Number(value) >= MIN_AGE && Number(value) <= MAX_AGE;
  }

  function isValidGender(value) {
    return GENDERS.some(function (entry) { return entry.value === value; });
  }

  function isValidMilitary(value) {
    return MILITARY.some(function (entry) { return entry.value === value; });
  }

  function isValidEducation(value) {
    return EDUCATION_VALUES.indexOf(String(value)) !== -1;
  }

  function isValidStartDate(value) {
    return START_DATES.indexOf(value) !== -1;
  }

  function isValidName(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text.length >= 2 && text.length <= 60 && !/[<>{}[\]\\]/.test(text) && !/https?:\/\/|www\./i.test(text);
  }

  function isValidEmail(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
  }

  // The Jornaya LeadiD token is a 36-character identifier issued by the Jornaya script.
  function isValidLeadIdToken(value) {
    return /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(String(value || ''));
  }

  return Object.freeze({
    MIN_AGE, MAX_AGE, MIN_GRAD_YEAR, MAX_GRAD_YEAR, GENDERS, MILITARY, EDUCATION_LEVELS, START_DATES,
    gradYears, isValidGradYear, isValidAge, isValidGender, isValidMilitary, isValidEducation,
    isValidStartDate, isValidName, isValidEmail, isValidLeadIdToken
  });
});
