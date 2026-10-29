import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAvailability,
  getActiveCampuses,
  getActivePrograms,
  isActiveProductionPair
} from "../src/js/availability.mjs";
import { normalizePhone } from "../src/js/phone.mjs";
import {
  validateCity,
  validateState,
  validateStreetAddress,
  validateZipCode
} from "../src/js/address.mjs";
import { validateLead } from "../netlify/functions/_shared/validation.mjs";
import { classifyLeadHoopResult, handler } from "../netlify/functions/submit-lead.mjs";

const available = {
  previewOnly: false,
  campuses: [
    {
      id: "campus-west",
      name: "West Campus",
      displayOrder: 1,
      active: true,
      leadHoopId: "approved-campus-route",
      programs: [
        { id: "program-a", name: "Program A", displayOrder: 1, active: true, leadHoopId: "approved-program-route" },
        { id: "program-paused", name: "Paused Program", displayOrder: 2, active: false, leadHoopId: "approved-paused-route" }
      ]
    },
    {
      id: "campus-paused",
      name: "Paused Campus",
      displayOrder: 2,
      active: false,
      leadHoopId: "approved-paused-campus-route",
      programs: [{ id: "program-b", name: "Program B", displayOrder: 1, active: true, leadHoopId: "approved-program-b-route" }]
    }
  ]
};

const validLead = {
  firstName: "Ari",
  lastName: "Taylor",
  email: "ari@example.test",
  phone: "(202) 555-0187",
  age: 28,
  gender: "F",
  gradYear: 2015,
  militaryType: "N",
  educationLevelId: "2275",
  startDate: "Immediately",
  campusId: "campus-west",
  programId: "program-a",
  consent: true,
  lead_address: {
    address: "123 Main St",
    city: "St. Louis",
    state: "MO",
    zip: "63101"
  }
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
  assert.equal(getActiveCampuses({ ...available, previewOnly: true }).length, 1);
  assert.equal(
    validateAvailability({
      ...available,
      campuses: [{ ...available.campuses[0], id: "preview-campus-west" }]
    }).some((error) => error.includes("Preview campus")),
    false
  );
});

test("address validation accepts supported formats and rejects invalid entries", () => {
  assert.equal(validateStreetAddress("123 Main St"), "");
  assert.equal(validateStreetAddress("456 Apt #5, Unit B"), "");
  assert.equal(validateStreetAddress("PO Box 123"), "");
  assert.equal(validateStreetAddress("I-40 Highway 50"), "");
  assert.equal(validateStreetAddress("123"), "Please enter a valid street address");
  assert.equal(validateStreetAddress("Main Street"), "Please enter a valid street address");
  assert.equal(validateStreetAddress("https://example.com"), "Please enter a valid street address");

  assert.equal(validateCity("St. Louis"), "");
  assert.equal(validateCity("Winston-Salem"), "");
  assert.equal(validateCity("O'Fallon"), "");
  assert.equal(validateCity("City 2"), "Please enter a valid city");
  assert.equal(validateCity("<script>alert(1)</script>"), "Please enter a valid city");

  assert.equal(validateState("CA"), "");
  assert.equal(validateState("ca"), "");
  assert.equal(validateState("ZZ"), "Please select a valid state");

  assert.equal(validateZipCode("12345"), "");
  assert.equal(validateZipCode("1234"), "Please enter a valid 5-digit ZIP code");
  assert.equal(validateZipCode("123456"), "Please enter a valid 5-digit ZIP code");
  assert.equal(validateZipCode("12 345"), "Please enter a valid 5-digit ZIP code");
});

test("server validation requires a valid active campus/program pair and consent", () => {
  assert.equal(validateLead(validLead, available).valid, true);
  assert.equal(validateLead({ ...validLead, campusId: "campus-paused" }, available).valid, false);
  assert.equal(validateLead({ ...validLead, programId: "program-paused" }, available).valid, false);
  assert.equal(validateLead({ ...validLead, campusId: "campus-west", programId: "program-b" }, available).valid, false);
  assert.equal(validateLead({ ...validLead, consent: false }, available).errors.consent, "Consent is required.");
  assert.equal(isActiveProductionPair(available, "preview-campus-west", "preview-program-west"), false);
  assert.equal(
    validateLead({ ...validLead, campusId: "preview-campus-west", programId: "preview-program-a" }, available).valid,
    false
  );

  const addressPayload = {
    ...validLead,
    lead_address: {
      address: " 123 Main St Apt #4 ",
      city: " St. Louis ",
      state: "ca",
      zip: "63101"
    }
  };
  assert.equal(validateLead(addressPayload, available).valid, true);
  assert.equal(validateLead({ ...addressPayload, lead_address: { ...addressPayload.lead_address, address: "https://bad" } }, available).errors.address, "Please enter a valid street address");
  assert.equal(validateLead({ ...addressPayload, lead_address: { ...addressPayload.lead_address, city: "City 2" } }, available).errors.city, "Please enter a valid city");
  assert.equal(validateLead({ ...addressPayload, lead_address: { ...addressPayload.lead_address, zip: "123456" } }, available).errors.zip, "Please enter a valid 5-digit ZIP code");
  assert.equal(validateLead({ ...addressPayload, lead_address: { ...addressPayload.lead_address, zip: "12345" } }, available).normalized.lead_address.zip, "12345");
});

test("production availability requires approved mappings for active options", () => {
  const { leadHoopId, ...unmappedCampus } = available.campuses[0];
  assert.ok(validateAvailability({
    ...available,
    campuses: [{ ...unmappedCampus, programs: available.campuses[0].programs }]
  }).some((error) => error.includes("requires a confirmed LeadHoop mapping")));
});

test("HTTP failure responses are not accepted even when the body claims success", () => {
  assert.equal(classifyLeadHoopResult(500, { status: "success", testing: true }), "infrastructure");
  assert.equal(classifyLeadHoopResult(200, { status: "failure", reason: { base: ["Advertiser rejected post."] }, testing: true }), "business_rejected");
  assert.equal(classifyLeadHoopResult(409, { status: "success", testing: true }), "duplicate");
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

  const previewSelection = await handler({
    httpMethod: "POST",
    body: JSON.stringify({
      ...validLead,
      campusId: "preview-campus-albuquerque",
      programId: "preview-program-albuquerque-dental-assistant"
    })
  });
  assert.equal(previewSelection.statusCode, 422);

  const nonPost = await handler({ httpMethod: "GET" });
  assert.equal(nonPost.statusCode, 405);
});
