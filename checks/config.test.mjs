import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateAvailability, getActivePrograms } from "../src/js/availability.mjs";
import { collectAttribution } from "../src/js/attribution.mjs";
import { isSubmissionConfigured } from "../netlify/functions/submit-lead.mjs";

test("guideline options are preview-only and isolated from empty production configuration", async () => {
  const preview = JSON.parse(await readFile(new URL("../src/data/uei-preview-campus-programs.json", import.meta.url), "utf8"));
  const production = JSON.parse(await readFile(new URL("../netlify/data/uei-campus-programs.json", import.meta.url), "utf8"));
  assert.equal(preview.previewOnly, true);
  assert.equal(preview.campuses.length, 22);
  assert.ok(preview.campuses.every((campus) => campus.id.startsWith("preview-campus-")));
  assert.ok(preview.campuses.every((campus) => campus.programs.every((program) => program.id.startsWith("preview-program-"))));
  assert.ok(preview.campuses.some((campus) => campus.programs.length > 1));
  assert.deepEqual(validateAvailability(preview), []);
  const albuquerque = preview.campuses.find((campus) => campus.name.startsWith("Albuquerque"));
  const bakersfield = preview.campuses.find((campus) => campus.name === "Bakersfield");
  assert.ok(albuquerque);
  assert.ok(bakersfield);
  assert.ok(getActivePrograms(preview, albuquerque.id).some((program) => program.name === "Medical Assistant"));
  assert.ok(!getActivePrograms(preview, albuquerque.id).some((program) => program.name === "Automotive Technician"));
  assert.ok(getActivePrograms(preview, bakersfield.id).some((program) => program.name === "Automotive Technician"));
  assert.equal(production.previewOnly, false);
  assert.deepEqual(production.campuses, []);
  assert.deepEqual(validateAvailability(production), []);
});

test("page has no forbidden campaign references or Google Maps integration", async () => {
  const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/css/site.css", import.meta.url), "utf8");
  assert.doesNotMatch(`${html}\n${css}`, /Launch Your Degree|Ultimate Medical Academy|UMA Kayla|uma-cbm/i);
  assert.doesNotMatch(`${html}\n${css}`, /googleapis\.com\/maps|maps\.google|places\.js/i);
  assert.match(html, /name="consent"[^>]*required/);
  const consentControl = html.match(/<input[^>]*name="consent"[^>]*>/)?.[0] ?? "";
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
  assert.match(form, /if \(completing\) return;/);
  assert.match(form, /submitButton\.disabled = true/);
  assert.match(form, /submitButton\.textContent = "Finishing preview…"/);
  assert.doesNotMatch(form, /fetch\("\/\.netlify\/functions\/submit-lead"/);
  assert.match(form, /No inquiry was sent/);
});
