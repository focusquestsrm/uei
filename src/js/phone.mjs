const PHONE_ALLOWED = /^\+?[\d\s().-]+$/;

export function normalizePhone(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!PHONE_ALLOWED.test(text)) return null;

  const digits = text.replace(/\D/g, "");
  let national;
  if (digits.length === 10 && !text.startsWith("+")) {
    national = digits;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    national = digits.slice(1);
  }

  return national && national[0] !== "1" ? national : null;
}
