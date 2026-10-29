import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { validateAvailability } from "../../src/js/availability.mjs";
import { validateLead } from "./_shared/validation.mjs";

const availabilityPath = fileURLToPath(new URL("../data/uei-campus-programs.json", import.meta.url));
const idempotencyStoreName = "uei-lead-idempotency";
const idempotencyTtlMs = 24 * 60 * 60 * 1000;

function parseBoolean(value, fallback = null) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
  }
  if (typeof value === "boolean") return value;
  return fallback;
}

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getEnvironment(event) {
  return {
    ...process.env,
    ...(event && typeof event === "object" ? event.env || {} : {}),
    ...(event && event.context && typeof event.context === "object" ? event.context.env || {} : {})
  };
}

export function isSubmissionConfigured(environment = {}) {
  if (parseBoolean(environment.LEAD_SUBMISSION_ENABLED, false) !== true) return false;
  if (!environment.LEADHOOP_ENDPOINT) return false;
  if (!environment.LEADHOOP_CAMPAIGN_CODE) return false;
  if (!environment.PUBLIC_SITE_URL) return false;
  if (parseBoolean(environment.LEAD_TEST_MODE, null) === null) return false;
  return true;
}

function normalizeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function getAllowedOrigins(environment = {}) {
  const values = [
    environment.ALLOWED_ORIGINS,
    environment.PUBLIC_SITE_URL,
    "http://localhost:8888",
    "http://127.0.0.1:8888"
  ];
  const origins = new Set();
  for (const value of values) {
    const text = readString(value);
    if (!text) continue;
    for (const item of text.split(",")) {
      const origin = normalizeOrigin(item.trim());
      if (origin) origins.add(origin);
    }
  }
  return [...origins];
}

function validateAllowedUrl(value, environment, fieldName) {
  const text = readString(value);
  if (!text) return { valid: false, error: `${fieldName} is required.` };
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return { valid: false, error: `${fieldName} must be a valid URL.` };
  }
  const allowed = getAllowedOrigins(environment);
  if (allowed.length > 0 && !allowed.includes(parsed.origin)) {
    return { valid: false, error: `${fieldName} is not permitted for this site.` };
  }
  return { valid: true, url: parsed.toString() };
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(body)
  };
}

function getRequestIp(event) {
  const header =
    event?.headers?.["x-nf-client-connection-ip"] ||
    event?.headers?.["client-ip"] ||
    event?.headers?.["x-forwarded-for"] ||
    event?.headers?.["x-real-ip"] ||
    event?.headers?.["X-NF-Client-Connection-IP"] ||
    "";
  const firstValue = String(header).split(",")[0].trim();
  return firstValue || null;
}

function buildLeadHoopForm(payload, availability, environment, event) {
  const campus = availability.campuses.find((item) => item.id === payload.campusId);
  const program = campus?.programs.find((item) => item.id === payload.programId);
  const form = new URLSearchParams();
  const testMode = parseBoolean(environment.LEAD_TEST_MODE, true);
  const origin = readString(environment.PUBLIC_SITE_URL).replace(/\/$/, "");
  const siteUrl = origin ? `${origin}/` : "";

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
  form.set("lead[service_leadid]", String(payload.serviceLeadId || payload.jornayaVisitorToken || ""));
  form.set("lead[service_trusted_form]", payload.serviceTrustedForm || "");
  form.set("lead[ip]", getRequestIp(event) || "");
  form.set("lead[signup_url]", payload.signupUrl || siteUrl || "/");
  form.set("lead[consent_url]", payload.consentUrl || siteUrl || "/");
  form.set("lead[test]", testMode ? "true" : "false");
  form.set("lead[media_type]", "noncallcenter");
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
  const headers = {
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    accept: "application/json"
  };
  if (environment.LEADHOOP_AUTHORIZATION) {
    headers.authorization = environment.LEADHOOP_AUTHORIZATION;
  }

  try {
    const result = await fetch(endpoint, {
      method: "POST",
      headers,
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
      payload: parsed
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

function extractReasonText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim().toLowerCase();
  if (Array.isArray(value)) {
    return value.map((item) => extractReasonText(item)).filter(Boolean).join(" ");
  }
  if (typeof value === "object") {
    return Object.values(value).map((item) => extractReasonText(item)).filter(Boolean).join(" ");
  }
  return String(value).trim().toLowerCase();
}

export function classifyLeadHoopResult(httpStatus, payload) {
  const numericStatus = Number(httpStatus);
  const statusCode = Number.isFinite(numericStatus) ? numericStatus : 0;
  const isHttpSuccess = statusCode >= 200 && statusCode < 300;

  if (payload && typeof payload === "object") {
    const status = String(payload.status || payload.outcome || payload.result || "").trim().toLowerCase();
    const message = extractReasonText(payload.message || payload.error || payload.reason || payload.reason_text || payload.message_text || payload.details || payload.data || payload.rejection_reason);
    const nestedReason = extractReasonText(payload.data?.rejection_reason || payload.details?.rejection_reason || payload.rejection_reason || payload.data || payload.details || payload.reason);

    if (["business_rejected", "rejected", "declined", "not_approved", "disqualified"].includes(status) || payload.business_rejected === true || message.includes("advertiser rejected") || message.includes("business reject") || message.includes("business rejected") || nestedReason.includes("advertiser rejected") || nestedReason.includes("business reject") || nestedReason.includes("business rejected") || nestedReason.includes("rejected post")) {
      return "business_rejected";
    }
    if (["duplicate", "duplicate_lead", "duplicate_submission", "already_received"].includes(status) || message.includes("duplicate") || nestedReason.includes("duplicate")) return "duplicate";
    if (["failure", "invalid", "error", "bad_request", "validation_error", "ineligible", "not_accepted"].includes(status) || message.includes("invalid") || message.includes("validation") || message.includes("ineligible") || nestedReason.includes("invalid") || nestedReason.includes("validation")) {
      return "invalid";
    }
    if (["accepted", "success", "ok", "processed", "posted"].includes(status) && isHttpSuccess) return "accepted";
  }

  if (statusCode === 409) return "duplicate";
  if (statusCode >= 500 || statusCode === 504) return "infrastructure";
  if (statusCode >= 400) return "invalid";
  if (isHttpSuccess) return "ambiguous";
  return "ambiguous";
}

function hashSubmissionKey(value) {
  const text = String(value || "");
  return `uei:${createHash("sha256").update(text).digest("hex").slice(0, 32)}`;
}

function createMemoryStore() {
  const records = new Map();
  return {
    async get(key) {
      return records.has(key) ? structuredClone(records.get(key)) : null;
    },
    async setJSON(key, value, options = {}) {
      if (options.onlyIfNew && records.has(key)) return null;
      records.set(key, structuredClone(value));
      return structuredClone(value);
    }
  };
}

async function getIdempotencyStore() {
  const { getStore } = await import("@netlify/blobs");
  return getStore({ name: idempotencyStoreName, consistency: "strong" });
}

async function readRecord(store, key) {
  if (!store || typeof store.get !== "function") return null;
  try {
    return await store.get(key, { type: "json", consistency: "strong" });
  } catch {
    return null;
  }
}

async function writeRecord(store, key, record, options = {}) {
  if (!store || typeof store.setJSON !== "function") return null;
  try {
    return await store.setJSON(key, record, options);
  } catch {
    return null;
  }
}

async function reserveSubmission(store, submissionId, requestId, now) {
  if (!submissionId) return { owner: false, record: null, reason: "missing-submission-id" };
  const key = hashSubmissionKey(submissionId);
  const candidate = {
    submissionId,
    state: "pending",
    createdAt: now,
    updatedAt: now,
    requestId: requestId || null
  };
  const existing = await readRecord(store, key);
  if (existing && existing.state && (now - new Date(existing.updatedAt || existing.createdAt || now).getTime()) < idempotencyTtlMs) {
    return { owner: false, record: existing };
  }
  const created = await writeRecord(store, key, candidate, { onlyIfNew: true });
  if (created !== null && created !== false) return { owner: true, record: candidate };
  const latest = await readRecord(store, key);
  if (latest && (now - new Date(latest.updatedAt || latest.createdAt || now).getTime()) < idempotencyTtlMs) {
    return { owner: false, record: latest };
  }
  return { owner: false, record: latest || candidate, reason: "reservation-failed" };
}

async function completeSubmission(store, submissionId, state, metadata) {
  if (!submissionId) return null;
  const key = hashSubmissionKey(submissionId);
  const current = await readRecord(store, key);
  if (!current) return null;
  const updated = {
    ...current,
    state,
    updatedAt: Date.now(),
    result: metadata || null
  };
  if (typeof store.setJSON === "function") {
    await store.setJSON(key, updated);
  }
  return updated;
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return response(405, { error: "Method not allowed." });

  const environment = getEnvironment(event);
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
    return response(500, { error: "Availability could not be verified. Please try again later." });
  }

  const availabilityErrors = validateAvailability(availability);
  if (availabilityErrors.length > 0) {
    return response(503, { error: "Availability could not be verified. Please try again later." });
  }

  const validation = validateLead(payload, availability);
  if (!validation.valid) return response(422, { errors: validation.errors });

  if (!isSubmissionConfigured(environment)) {
    return response(503, { error: "Lead submission is not configured for this preview." });
  }

  const submissionId = readString(payload.submissionId || payload.id || payload.requestId || payload.jornayaVisitorToken);
  if (!submissionId) {
    return response(422, { error: "A valid submission id is required." });
  }

  const consentCheck = validateAllowedUrl(payload.consentUrl || payload.signupUrl || event.headers?.origin || environment.PUBLIC_SITE_URL, environment, "lead[consent_url]");
  if (!consentCheck.valid) return response(400, { error: consentCheck.error });
  const signupCheck = validateAllowedUrl(payload.signupUrl || event.headers?.origin || environment.PUBLIC_SITE_URL, environment, "lead[signup_url]");
  if (!signupCheck.valid) return response(400, { error: signupCheck.error });

  const ipAddress = getRequestIp(event);
  if (!ipAddress) {
    return response(503, { error: "Consumer IP address is unavailable for this request." });
  }

  const jornayaToken = readString(payload.jornayaVisitorToken || payload.serviceLeadId || payload["lead[service_leadid]"] || payload.jornayaLeadId);
  if (!jornayaToken) {
    return response(422, { error: "A valid Jornaya visitor token is required." });
  }

  if (payload.consent !== true) {
    return response(422, { error: "Consent is required." });
  }

  const requestId = event?.headers?.["x-nf-request-id"] || event?.headers?.["X-Nf-Request-Id"] || submissionId;
  const store = await getIdempotencyStore();
  const reservation = await reserveSubmission(store, submissionId, requestId, Date.now());
  if (!reservation.owner) {
    const record = reservation.record || {};
    const priorState = record.state || "pending";
    if (priorState === "accepted" || priorState === "business_rejected") {
      return response(200, { status: priorState, message: "This submission has already been processed." });
    }
    if (priorState === "duplicate") {
      return response(409, { error: "Duplicate lead submission detected." });
    }
    return response(202, { status: "pending", message: "This submission is already being processed." });
  }

  const serverTestMode = parseBoolean(environment.LEAD_TEST_MODE, null);
  if (serverTestMode === null) {
    await completeSubmission(store, submissionId, "invalid", { code: "missing_test_mode" });
    return response(503, { error: "Lead test mode is not configured." });
  }

  const allowedOrigins = getAllowedOrigins(environment);
  const signupUrl = payload.signupUrl || environment.PUBLIC_SITE_URL || "";
  const consentUrl = payload.consentUrl || environment.PUBLIC_SITE_URL || "";
  if (!validateAllowedUrl(signupUrl, environment, "lead[signup_url]").valid || !validateAllowedUrl(consentUrl, environment, "lead[consent_url]").valid) {
    await completeSubmission(store, submissionId, "invalid", { code: "invalid_url" });
    return response(400, { error: "The consent and signup URLs are not permitted for this site." });
  }

  const normalized = {
    ...payload,
    ...validation.normalized,
    consent: true,
    ip: ipAddress,
    signupUrl,
    consentUrl,
    jornayaVisitorToken: jornayaToken,
    serviceLeadId: jornayaToken,
    test: serverTestMode
  };
  const form = buildLeadHoopForm(normalized, availability, environment, event);
  const result = await submitToLeadHoop(form, environment);
  const vendorStatus = classifyLeadHoopResult(result.status, result.payload);

  if (vendorStatus === "accepted") {
    await completeSubmission(store, submissionId, "accepted", { httpStatus: result.status, outcome: "accepted" });
    return response(200, { status: "accepted", message: "Lead submitted successfully.", testMode: serverTestMode });
  }

  if (vendorStatus === "business_rejected") {
    await completeSubmission(store, submissionId, "business_rejected", { httpStatus: result.status, outcome: "business_rejected" });
    return response(200, { status: "business_rejected", message: "Lead was accepted by the form but not approved by the recipient.", testMode: serverTestMode });
  }

  if (vendorStatus === "duplicate") {
    await completeSubmission(store, submissionId, "duplicate", { httpStatus: result.status, outcome: "duplicate" });
    return response(409, { error: "Duplicate lead submission detected." });
  }

  if (vendorStatus === "invalid" || !result.ok) {
    await completeSubmission(store, submissionId, "invalid", { httpStatus: result.status, outcome: "invalid" });
    return response(422, { error: "Lead could not be posted with the provided information." });
  }

  await completeSubmission(store, submissionId, "ambiguous", { httpStatus: result.status, outcome: "ambiguous" });
  return response(504, { error: "Submission could not be confirmed. Please try again later." });
}

export default { handler };
