import test from "node:test";
import assert from "node:assert/strict";
import { validateAvailability, getActiveCampuses, getActivePrograms } from "../src/js/availability.mjs";
import { normalizePhone } from "../src/js/phone.mjs";
import { validateLead } from "../netlify/functions/_shared/validation.mjs";
import { handler } from "../netlify/functions/submit-lead.mjs";

const available = {
  previewOnly: false,
  campuses: [
    {
      id: "campus-west",
      name: "West Campus",
      displayOrder: 1,
      active: true,
      programs: [
        { id: "program-a", name: "Program A", displayOrder: 1, active: true },
        { id: "program-paused", name: "Paused Program", displayOrder: 2, active: false }
      ]
    },
    {
      id: "campus-paused",
      name: "Paused Campus",
      displayOrder: 2,
      active: false,
      programs: [{ id: "program-b", name: "Program B", displayOrder: 1, active: true }]
    }
  ]
};

const validLead = {
  firstName: "Ari",
  lastName: "Taylor",
  email: "ari@example.test",
  phone: "(202) 555-0187",
  campusId: "campus-west",
  programId: "program-a",
  consent: true
};

test("phone normalization accepts supported US formats and rejects malformed values", () => {
  assert.equal(normalizePhone("(202) 555-0187"), "2025550187");
  assert.equal(normalizePhone("+1 202-555-0187"), "2025550187");
  assert.equal(normalizePhone("12025550187"), "2025550187");
  assert.equal(normalizePhone("202555018"), null);
  assert.equal(normalizePhone("120255501877"), null);
  assert.equal(normalizePhone("202-555-0187 ext 4"), null);
});

test("availability schema uses stable IDs, names, order, and active flags", () => {
  assert.deepEqual(validateAvailability(available), []);
  assert.equal(getActiveCampuses(available).length, 1);
  assert.deepEqual(getActivePrograms(available, "campus-west").map((item) => item.id), ["program-a"]);
  assert.equal(getActiveCampuses({ ...available, previewOnly: true }).length, 0);
});

test("server validation requires a valid active campus/program pair and consent", () => {
  assert.equal(validateLead(validLead, available).valid, true);
  assert.equal(validateLead({ ...validLead, campusId: "campus-paused" }, available).valid, false);
  assert.equal(validateLead({ ...validLead, programId: "program-paused" }, available).valid, false);
  assert.equal(validateLead({ ...validLead, campusId: "campus-west", programId: "program-b" }, available).valid, false);
  assert.equal(validateLead({ ...validLead, consent: false }, available).errors.consent, "Consent is required.");
});

test("preview selections and incomplete configuration cannot submit", async () => {
  const nullPayload = await handler({
    httpMethod: "POST",
    body: "null"
  });
  assert.equal(nullPayload.statusCode, 422);

  const invalid = await handler({
    httpMethod: "POST",
    body: JSON.stringify(validLead)
  });
  assert.equal(invalid.statusCode, 422);

  const nonPost = await handler({ httpMethod: "GET" });
  assert.equal(nonPost.statusCode, 405);
});
