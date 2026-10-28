export const US_STATE_ABBREVIATIONS = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA",
  "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY",
  "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX",
  "UT", "VT", "VA", "WA", "WV", "WI", "WY"
];

function normalizeInput(value) {
  return typeof value === "string" ? value.trim() : "";
}

function containsUnsafeContent(value) {
  return /(?:https?:\/\/|www\.)/i.test(value)
    || /@/.test(value)
    || /<\s*(?:script|iframe|svg|img|object)|<\/?(?:script|iframe|svg)|javascript:/i.test(value)
    || /on\w+=/i.test(value)
    || /[<>]/.test(value);
}

export function validateStreetAddress(value) {
  const trimmed = normalizeInput(value);

  if (!trimmed || trimmed.length < 4) return "Please enter a valid street address";
  if (!/[A-Za-z]/.test(trimmed) || !/\d/.test(trimmed)) return "Please enter a valid street address";
  if (/^[\s.,#'/\-\/]+$/.test(trimmed)) return "Please enter a valid street address";
  if (!/^[A-Za-z0-9\s.,#'/\-\/]+$/.test(trimmed)) return "Please enter a valid street address";
  if (containsUnsafeContent(trimmed)) return "Please enter a valid street address";
  if (/(?:[.,#'\/\-])\1{2,}/.test(trimmed) || /(?:\s[.,#'\/\-]){2,}/.test(trimmed)) {
    return "Please enter a valid street address";
  }

  return "";
}

export function validateCity(value) {
  const trimmed = normalizeInput(value);

  if (!trimmed) return "Please enter a valid city";
  if (!/[A-Za-z]/.test(trimmed)) return "Please enter a valid city";
  if (!/^[A-Za-z\s.'\-]+$/.test(trimmed)) return "Please enter a valid city";
  if (containsUnsafeContent(trimmed) || /\d/.test(trimmed)) return "Please enter a valid city";
  if (/^[\s.'\-]+$/.test(trimmed)) return "Please enter a valid city";

  return "";
}

export function validateState(value) {
  const trimmed = normalizeInput(value).toUpperCase();
  return trimmed && US_STATE_ABBREVIATIONS.includes(trimmed) ? "" : "Please select a valid state";
}

export function validateZipCode(value) {
  const trimmed = normalizeInput(value);
  return /^\d{5}$/.test(trimmed) ? "" : "Please enter a valid 5-digit ZIP code";
}
