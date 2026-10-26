import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateAvailability } from "../src/js/availability.mjs";
import { collectAttribution } from "../src/js/attribution.mjs";
import { isSubmissionConfigured } from "../netlify/functions/submit-lead.mjs";

test("checked-in availability is explicitly preview-only and contains no invented options", async () => {
  const config = JSON.parse(await readFile(new URL("../src/data/uei-campus-programs.json", import.meta.url), "utf8"));
  assert.equal(config.previewOnly, true);
  assert.deepEqual(config.campuses, []);
  assert.deepEqual(validateAvailability(config), []);
});

test("page has no forbidden campaign references or Google Maps integration", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/css/site.css", import.meta.url), "utf8");
  assert.doesNotMatch(`${html}\n${css}`, /Launch Your Degree|Ultimate Medical Academy|UMA Kayla|uma-cbm/i);
  assert.doesNotMatch(`${html}\n${css}`, /googleapis\.com\/maps|maps\.google|places\.js/i);
  assert.match(html, /type="checkbox" name="consent"[^>]*required/);
  assert.match(html, /name="consent"[^>]*required/);
  const consentControl = html.match(/<input type="checkbox" name="consent"[^>]*>/)?.[0] ?? "";
  assert.doesNotMatch(consentControl, /\bchecked\b/i);
  assert.match(html, /https:\/\/www\.uei\.edu\/privacy-policy-terms\//);
  assert.match(html, /Message &amp; data rates may apply\. Messages are recurring\./);
  assert.match(html, /I understand I do not\s+need to provide such consent/);
  assert.match(html, /All programs not available at all campus locations/);
  assert.match(html, /Length varies by program/);
  assert.match(html, /Financial aid is available for those who qualify/);
});

test("attribution values are preserved as raw fields without assigning LeadHoop mappings", () => {
  assert.deepEqual(
    collectAttribution("?fbclid=click-1&_fbc=browser-cookie&_fbp=pixel-cookie&unknown=ignored"),
    { fbclid: "click-1", _fbc: "browser-cookie", _fbp: "pixel-cookie" }
  );
});

test("outbound posting configuration is disabled until all protected settings exist", () => {
  assert.equal(isSubmissionConfigured({ LEAD_SUBMISSION_ENABLED: "false" }), false);
  assert.equal(isSubmissionConfigured({ LEAD_SUBMISSION_ENABLED: "true" }), false);
});

test("client prevents concurrent submissions and exposes a loading state", async () => {
  const form = await readFile(new URL("../src/js/form.mjs", import.meta.url), "utf8");
  assert.match(form, /if \(submitting\) return;/);
  assert.match(form, /submitButton\.disabled = true/);
  assert.match(form, /submitButton\.textContent = "Sending…"/);
});
