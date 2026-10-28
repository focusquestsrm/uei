import { normalizePhone } from "../../../src/js/phone.mjs";
import { isActiveProductionPair } from "../../../src/js/availability.mjs";
import {
  validateCity,
  validateState,
  validateStreetAddress,
  validateZipCode
} from "../../../src/js/address.mjs";

export { normalizePhone };

const VALID_GENDERS = new Set(["M", "F"]);
const VALID_MILITARY_TYPES = new Set(["Y", "N"]);
const VALID_START_DATES = new Set(["Immediately", "1-3 Months", "4-6 Months", "7-12 Months", "More than 1 Year", "Not Sure"]);
const VALID_EDUCATION_LEVELS = new Set(["2274", "2275", "2276", "2277", "2278", "2279"]);

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function normalizeLeadPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const firstName = readString(payload.firstName ?? payload.firstname);
  const lastName = readString(payload.lastName ?? payload.lastname);
  const email = readString(payload.email);
  const phone = normalizePhone(typeof payload.phone === "string" ? payload.phone : "");

  let leadAddress = null;
  if (payload.lead_address && typeof payload.lead_address === "object" && !Array.isArray(payload.lead_address)) {
    leadAddress = payload.lead_address;
  }
  const hasAddressFields = Boolean(
    leadAddress ||
    typeof payload.address === "string" ||
    typeof payload.city === "string" ||
    typeof payload.state === "string" ||
    typeof payload.zip === "string"
  );

  const addressValue = readString(leadAddress?.address ?? payload.address);
  const cityValue = readString(leadAddress?.city ?? payload.city);
  const stateValue = readString(leadAddress?.state ?? payload.state);
  const zipValue = readString(leadAddress?.zip ?? payload.zip);

  const ageValue = readOptionalNumber(payload.age ?? payload["lead[age]"] ?? payload.ageValue);
  const genderValue = readString(payload.gender ?? payload["lead[gender]"] ?? payload.genderValue).toUpperCase();
  const gradYearValue = readOptionalNumber(payload.gradYear ?? payload.grad_year ?? payload["lead_education[grad_year]"] ?? payload.graduationYear);
  const militaryValue = readString(payload.militaryType ?? payload.military_type ?? payload["lead_background[military_type]"]).toUpperCase();
  const educationValue = readString(payload.educationLevelId ?? payload.education_level_id ?? payload["lead_education[education_level_id]"]);
  const startDateValue = readString(payload.startDate ?? payload.start_date ?? payload["lead_education[start_date]"]);
  const campusId = readString(payload.campusId ?? payload.campus_id);
  const programId = readString(payload.programId ?? payload.program_id);

  return {
    firstName,
    lastName,
    email,
    phone,
    campusId,
    programId,
    age: ageValue,
    gender: genderValue,
    gradYear: gradYearValue,
    militaryType: militaryValue,
    educationLevelId: educationValue,
    startDate: startDateValue,
    hasAddressFields,
    lead_address: {
      address: addressValue,
      city: cityValue,
      state: stateValue,
      zip: zipValue
    }
  };
}

export function validateLead(payload, availability) {
  const errors = {};
  const normalized = normalizeLeadPayload(payload);
  if (!normalized) {
    return {
      valid: false,
      errors: { _form: "A JSON object is required." },
      normalized: { firstName: "", lastName: "", email: "", phone: null, lead_address: { address: "", city: "", state: "", zip: "" } }
    };
  }

  const firstName = normalized.firstName;
  const lastName = normalized.lastName;
  const email = normalized.email;
  const phone = normalized.phone;
  const campusId = normalized.campusId;
  const programId = normalized.programId;
  const addressValue = normalized.lead_address.address;
  const cityValue = normalized.lead_address.city;
  const stateValue = normalized.lead_address.state;
  const zipValue = normalized.lead_address.zip;

  if (!firstName || firstName.length < 2 || firstName.length > 100) errors.firstName = "Enter your first name.";
  if (!lastName || lastName.length < 2 || lastName.length > 100) errors.lastName = "Enter your last name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    errors.email = "Enter a valid email address.";
  }
  if (!phone) errors.phone = "Enter a valid 10-digit US phone number.";
  if (typeof campusId !== "string" || !campusId) {
    errors.campusId = "Select an available campus.";
  }
  if (typeof programId !== "string" || !programId) {
    errors.programId = "Select an available program.";
  }
  if (
    typeof campusId === "string" &&
    typeof programId === "string" &&
    !isActiveProductionPair(availability, campusId, programId)
  ) {
    errors.programId = "That campus and program combination is not currently available.";
  }

  if (normalized.age !== null) {
    const age = Number(normalized.age);
    if (!Number.isInteger(age) || age < 18) errors.age = "You must be at least 18 years old.";
  }

  if (normalized.gender) {
    if (!VALID_GENDERS.has(normalized.gender)) errors.gender = "Select a valid gender.";
  }

  if (normalized.gradYear !== null) {
    const year = Number(normalized.gradYear);
    if (!Number.isInteger(year) || year < 1998 || year > 2024) {
      errors.gradYear = "Enter a valid high school graduation year between 1998 and 2024.";
    }
  }

  if (normalized.militaryType) {
    if (!VALID_MILITARY_TYPES.has(normalized.militaryType)) errors.militaryType = "Select a valid military status.";
  }

  if (normalized.educationLevelId) {
    if (!VALID_EDUCATION_LEVELS.has(normalized.educationLevelId)) errors.educationLevelId = "Select a valid education level.";
  }

  if (normalized.startDate) {
    if (!VALID_START_DATES.has(normalized.startDate)) errors.startDate = "Select a valid start date.";
  }

  if (normalized.hasAddressFields) {
    const streetError = validateStreetAddress(addressValue);
    const cityError = validateCity(cityValue);
    const stateError = validateState(stateValue);
    const zipError = validateZipCode(zipValue);
    if (streetError) errors.address = streetError;
    if (cityError) errors.city = cityError;
    if (stateError) errors.state = stateError;
    if (zipError) errors.zip = zipError;
  }

  if (payload.consent !== true) errors.consent = "Consent is required.";

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    normalized: {
      firstName,
      lastName,
      email,
      phone,
      age: normalized.age,
      gender: normalized.gender,
      gradYear: normalized.gradYear,
      militaryType: normalized.militaryType,
      educationLevelId: normalized.educationLevelId,
      startDate: normalized.startDate,
      lead_address: {
        address: addressValue,
        city: cityValue,
        state: stateValue.toUpperCase(),
        zip: zipValue
      }
    }
  };
}
