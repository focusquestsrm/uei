import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateAvailability } from "../../src/js/availability.mjs";
import { validateLead } from "./_shared/validation.mjs";

const availabilityPath = fileURLToPath(new URL("../data/uei-campus-programs.json", import.meta.url));
const requiredSettings = [
  "LEADHOOP_ENDPOINT",
  "LEADHOOP_AUTHORIZATION",
  "LEADHOOP_FPI",
  "LEADHOOP_CAMPAIGN_CODE",
  "LEADHOOP_FIELD_MAPPINGS",
  "LEADHOOP_ACCEPTED_REDIRECT",
  "LEADHOOP_REJECTED_REDIRECT",
  "LEADHOOP_DEDUPLICATION_STORE",
  "UEI_PRIVACY_POLICY_URL"
];

export function isSubmissionConfigured(environment) {
  return environment.LEAD_SUBMISSION_ENABLED === "true" &&
    requiredSettings.every((name) => Boolean(environment[name]));
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body)
  };
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return response(405, { error: "Method not allowed." });

  let payload;
  try {
    payload = JSON.parse(event.body || "");
  } catch {
    return response(400, { error: "A valid JSON request is required." });
  }

  let availability;
  try {
    availability = JSON.parse(await readFile(availabilityPath, "utf8"));
  } catch (error) {
    console.error("Unable to read UEI campus/program availability.", error);
    return response(500, { error: "Availability could not be verified. Please try again later." });
  }

  const availabilityErrors = validateAvailability(availability);
  if (availabilityErrors.length > 0) {
    console.error("UEI campus/program availability is invalid.", availabilityErrors);
    return response(503, { error: "Availability could not be verified. Please try again later." });
  }

  const validation = validateLead(payload, availability);
  if (!validation.valid) return response(422, { errors: validation.errors });

  if (!isSubmissionConfigured(process.env)) {
    return response(503, { error: "Lead submission is not configured for this preview." });
  }

  return response(503, {
    error: "Lead submission remains disabled until the verified UEI posting integration is implemented."
  });
}

export default { handler };
