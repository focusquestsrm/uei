import { normalizePhone } from "../../../src/js/phone.mjs";

export { normalizePhone };

function isActivePair(availability, campusId, programId) {
  if (!availability || availability.previewOnly === true || !Array.isArray(availability.campuses)) {
    return false;
  }

  const campus = availability.campuses.find((item) => item.id === campusId && item.active === true);
  return Boolean(
    campus &&
      Array.isArray(campus.programs) &&
      campus.programs.some((program) => program.id === programId && program.active === true)
  );
}

export function validateLead(payload, availability) {
  const errors = {};
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      valid: false,
      errors: { _form: "A JSON object is required." },
      normalized: { firstName: "", lastName: "", email: "", phone: null }
    };
  }

  const firstName = typeof payload.firstName === "string" ? payload.firstName.trim() : "";
  const lastName = typeof payload.lastName === "string" ? payload.lastName.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const phone = normalizePhone(payload.phone);

  if (!firstName || firstName.length > 100) errors.firstName = "Enter your first name.";
  if (!lastName || lastName.length > 100) errors.lastName = "Enter your last name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    errors.email = "Enter a valid email address.";
  }
  if (!phone) errors.phone = "Enter a valid 10-digit US phone number.";
  if (typeof payload.campusId !== "string" || !payload.campusId) {
    errors.campusId = "Select an available campus.";
  }
  if (typeof payload.programId !== "string" || !payload.programId) {
    errors.programId = "Select an available program.";
  }
  if (!isActivePair(availability, payload.campusId, payload.programId)) {
    errors.programId = "That campus and program combination is not currently available.";
  }
  if (payload.consent !== true) errors.consent = "Consent is required.";

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    normalized: { firstName, lastName, email, phone }
  };
}
