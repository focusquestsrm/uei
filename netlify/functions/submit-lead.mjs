import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateAvailability } from "../../src/js/availability.mjs";
import { validateLead } from "./_shared/validation.mjs";

const availabilityPath = fileURLToPath(new URL("../data/uei-campus-programs.json", import.meta.url));
const requiredSettings = [
  "LEADHOOP_ENDPOINT",
  "LEADHOOP_AUTHORIZATION",
  "LEADHOOP_CAMPAIGN_CODE",
  "PUBLIC_SITE_URL",
  "UEI_PRIVACY_POLICY_URL"
];

export function isSubmissionConfigured(environment) {
  return environment.LEAD_SUBMISSION_ENABLED === "true" && requiredSettings.every((name) => Boolean(environment[name]));
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body)
  };
}

function getRequestIp(event) {
  const header = event.headers?.["x-nf-client-connection-ip"] || event.headers?.["client-ip"] || event.headers?.["x-forwarded-for"] || event.headers?.["x-real-ip"] || "";
  return header.split(",")[0].trim() || "127.0.0.1";
}

function buildLeadHoopForm(payload, availability, environment, event) {
  const campus = availability.campuses.find((item) => item.id === payload.campusId);
  const program = campus?.programs.find((item) => item.id === payload.programId);
  const form = new URLSearchParams();

  const baseUrl = (environment.PUBLIC_SITE_URL || "https://uei-cbm.back2learn.com").replace(/\/$/, "");
  const consentUrl = environment.UEI_PRIVACY_POLICY_URL || "https://www.uei.edu/privacy-policy-terms/";
  const siteUrl = `${baseUrl}/`; 

  form.set("campaign_code", environment.LEADHOOP_CAMPAIGN_CODE);
  form.set("lead[firstname]", payload.firstName);
  form.set("lead[lastname]", payload.lastName);
  form.set("lead_address[address]", payload.lead_address.address);
  form.set("lead_address[address2]", payload.lead_address.address2 || "");
  form.set("lead_address[city]", payload.lead_address.city);
  form.set("lead_address[state]", payload.lead_address.state.toUpperCase());
  form.set("lead_address[zip]", payload.lead_address.zip);
  form.set("lead[email]", payload.email);
  form.set("lead[phone1]", payload.phone);
  form.set("lead[age]", String(payload.age ?? ""));
  form.set("lead[gender]", payload.gender ?? "");
  form.set("lead_education[grad_year]", String(payload.gradYear ?? ""));
  form.set("lead_background[military_type]", payload.militaryType ?? "");
  form.set("lead_education[education_level_id]", payload.educationLevelId ?? "");
  form.set("lead_education[program_id]", String(program?.leadHoopId ?? payload.programId));
  form.set("lead_education[campus_id]", String(campus?.leadHoopId ?? payload.campusId));
  form.set("lead_education[start_date]", payload.startDate ?? "");
  form.set("lead_consent[tcpa_consent]", payload.consent ? "Y" : "N");
  form.set("lead[service_leadid]", String(payload.serviceLeadId || payload.jornayaLeadId || ""));
  form.set("lead[service_trusted_form]", payload.serviceTrustedForm || "");
  form.set("lead[ip]", payload.ip || getRequestIp(event));
  form.set("lead[signup_url]", payload.signupUrl || siteUrl);
  form.set("lead[consent_url]", payload.consentUrl || consentUrl);
  form.set("lead[test]", String(payload.test === true ? "true" : "false"));
  form.set("lead[media_type]", "noncallcenter");
  form.set("lead[service_trusted_form]", payload.serviceTrustedForm || "");
  form.set("subid", payload.subid || "");
  form.set("subid2", payload.subid2 || "");
  form.set("subid3", payload.subid3 || "");
  form.set("subid4", payload.subid4 || "");
  form.set("pub_transaction_id", payload.pubTransactionId || "");
  form.set("agent_id", payload.agentId || "");
  form.set("utm_source", payload.utmSource || "");
  form.set("utm_medium", payload.utmMedium || "");
  form.set("utm_campaign", payload.utmCampaign || "");
  form.set("utm_term", payload.utmTerm || "");
  form.set("utm_content", payload.utmContent || "");
  form.set("lead[cost]", payload.cost ?? "");
  form.set("lead[revenue]", payload.revenue ?? "");
  return form;
}

async function submitToLeadHoop(form, environment) {
  const endpoint = environment.LEADHOOP_ENDPOINT;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const result = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: environment.LEADHOOP_AUTHORIZATION,
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        accept: "application/json"
      },
      body: form.toString(),
      signal: controller.signal
    });

    const text = await result.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }

    return {
      ok: result.ok,
      status: result.status,
      payload: parsed,
      request: form.toString()
    };
  } catch (error) {
    return {
      ok: false,
      status: 504,
      error: error && error.name === "AbortError" ? "timeout" : "network",
      payload: { status: "timeout" }
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseVendorStatus(payload) {
  if (payload && typeof payload === "object") {
    if (payload.status === "success") return "accepted";
    if (payload.status === "failure") return "rejected";
    if (payload.status === "duplicate") return "duplicate";
    if (payload.status === "rejected") return "rejected";
    if (payload.status === "error") return "invalid";
    if (payload.error) return "invalid";
  }
  return "ambiguous";
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

  const isTestLead = payload.test === true;
  const normalized = { ...payload, ...validation.normalized, ip: getRequestIp(event), consent: Boolean(payload.consent === true), test: isTestLead };
  const form = buildLeadHoopForm(normalized, availability, process.env, event);
  const result = await submitToLeadHoop(form, process.env);
  const vendorStatus = parseVendorStatus(result.payload);

  if (result.status === 504 || result.error === "timeout" || vendorStatus === "ambiguous") {
    console.error("LeadHoop submission timed out or responded ambiguously.", result);
    return response(504, { error: "Submission could not be confirmed. Please try again later." });
  }

  if (vendorStatus === "accepted") {
    return response(200, { status: "accepted", message: "Lead submitted successfully." });
  }

  if (vendorStatus === "rejected") {
    return response(200, { status: "business_rejected", message: "Lead was accepted by the form but was not approved by the recipient." });
  }

  if (vendorStatus === "duplicate") {
    return response(409, { error: "Duplicate lead submission detected." });
  }

  if (!result.ok || vendorStatus === "invalid") {
    return response(422, { error: "Lead could not be posted with the provided information." });
  }

  return response(200, { status: "accepted", message: "Lead submitted successfully." });
}

export default { handler };
