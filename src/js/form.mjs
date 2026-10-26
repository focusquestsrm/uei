import { getActiveCampuses, getActivePrograms } from "./availability.mjs";
import { collectAttribution } from "./attribution.mjs";
import { normalizePhone } from "./phone.mjs";

const form = document.querySelector("#inquiry-form");
const campusSelect = document.querySelector("#campus");
const programSelect = document.querySelector("#program");
const stepPanels = [...document.querySelectorAll("[data-step-panel]")];
const stepStatus = document.querySelector("#step-status");
const feedback = document.querySelector("#form-feedback");
const continueButton = document.querySelector("#continue-button");
const backButton = document.querySelector("#back-button");
const submitButton = document.querySelector("#submit-button");
const phoneInput = document.querySelector("#phone");
const phoneError = document.querySelector("#phone-error");
const noOptions = document.querySelector("#no-options");
const attribution = collectAttribution(window.location.search);
let availability = { previewOnly: true, campuses: [] };
let currentStep = 1;
let submitting = false;

function addOptions(select, values, placeholder) {
  select.replaceChildren(new Option(placeholder, ""));
  for (const item of values) select.add(new Option(item.name, item.id));
}

function updateCampusOptions() {
  const campuses = getActiveCampuses(availability);
  addOptions(campusSelect, campuses, "Select a campus");
  noOptions.hidden = campuses.length > 0;
  noOptions.textContent = availability.previewOnly
    ? "No eligible campus or program options are available in this preview."
    : "No eligible campus options are available right now.";
  updateProgramOptions();
}

function updateProgramOptions() {
  const programs = getActivePrograms(availability, campusSelect.value);
  addOptions(programSelect, programs, "Select a program");
  programSelect.disabled = programs.length === 0;
  if (campusSelect.value && programs.length === 0) {
    noOptions.textContent = "No eligible programs are currently available for this campus.";
    noOptions.hidden = false;
  } else if (getActiveCampuses(availability).length > 0) {
    noOptions.hidden = true;
  }
}

function showStep(step) {
  currentStep = step;
  for (const panel of stepPanels) panel.hidden = Number(panel.dataset.stepPanel) !== step;
  stepStatus.textContent = `Step ${step} of 2`;
  backButton.hidden = step === 1;
  continueButton.hidden = step === 2;
  submitButton.hidden = step !== 2;
  if (step === 2) document.querySelector("#first-name").focus();
  else campusSelect.focus();
}

function showFieldError(name, message) {
  const field = form.elements.namedItem(name);
  const error = document.querySelector(`#${name}-error`);
  if (!field || !error) return;
  field.setAttribute("aria-invalid", message ? "true" : "false");
  error.textContent = message;
}

function validateContact() {
  const fields = [
    ["firstName", "Enter your first name."],
    ["lastName", "Enter your last name."]
  ];
  let valid = true;
  for (const [name, defaultMessage] of fields) {
    const field = form.elements.namedItem(name);
    const message = !field.value.trim() ? defaultMessage : "";
    showFieldError(name, message);
    valid &&= !message;
  }

  const email = form.elements.namedItem("email").value.trim();
  const emailError = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "" : "Enter a valid email address.";
  showFieldError("email", emailError);
  valid &&= !emailError;

  const normalizedPhone = normalizePhone(phoneInput.value);
  const invalidPhone = normalizedPhone === null;
  phoneError.textContent = invalidPhone ? "Enter a valid 10-digit US phone number." : "";
  phoneInput.setAttribute("aria-invalid", invalidPhone ? "true" : "false");
  if (!invalidPhone) phoneInput.value = normalizedPhone;
  valid &&= !invalidPhone;

  const consent = form.elements.namedItem("consent");
  const consentError = consent.checked ? "" : "Consent is required before a request can be sent.";
  showFieldError("consent", consentError);
  valid &&= !consentError;
  return valid;
}

campusSelect.addEventListener("change", () => {
  programSelect.value = "";
  updateProgramOptions();
  showFieldError("campusId", "");
  showFieldError("programId", "");
});

continueButton.addEventListener("click", () => {
  feedback.textContent = "";
  if (!availability.previewOnly) {
    const activeCampuses = getActiveCampuses(availability);
    const activePrograms = getActivePrograms(availability, campusSelect.value);
    const campusError = activeCampuses.length === 0
      ? "No campus options are currently available."
      : campusSelect.value
        ? ""
        : "Select an available campus.";
    const programError = activePrograms.length === 0
      ? "No programs are currently available for this campus."
      : programSelect.value
        ? ""
        : "Select an available program.";
    showFieldError("campusId", campusError);
    showFieldError("programId", programError);
    if (campusError || programError) {
      if (activeCampuses.length === 0) {
        feedback.textContent = "There are no eligible campus options available right now.";
      } else {
        form.querySelector('[aria-invalid="true"]')?.focus();
      }
      return;
    }
  }
  showStep(2);
});

backButton.addEventListener("click", () => showStep(1));

phoneInput.addEventListener("blur", () => {
  const normalized = normalizePhone(phoneInput.value);
  phoneError.textContent = phoneInput.value && !normalized ? "Enter a valid 10-digit US phone number." : "";
  if (normalized) phoneInput.value = normalized;
  phoneInput.setAttribute("aria-invalid", phoneError.textContent ? "true" : "false");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submitting) return;
  if (!validateContact()) {
    form.querySelector('[aria-invalid="true"]')?.focus();
    return;
  }
  if (availability.previewOnly || getActivePrograms(availability, campusSelect.value).length === 0) {
    feedback.textContent = "This is a local preview. No request was sent; campaign options and approved consent copy are not configured.";
    return;
  }

  submitting = true;
  submitButton.disabled = true;
  submitButton.textContent = "Sending…";
  feedback.textContent = "Checking campaign availability…";
  try {
    const response = await fetch("/.netlify/functions/submit-lead", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        firstName: form.elements.namedItem("firstName").value.trim(),
        lastName: form.elements.namedItem("lastName").value.trim(),
        email: form.elements.namedItem("email").value.trim(),
        phone: phoneInput.value,
        campusId: campusSelect.value,
        programId: programSelect.value,
        consent: form.elements.namedItem("consent").checked,
        attribution
      })
    });
    const result = await response.json();
    feedback.textContent = result.error || (response.ok ? "Your request was received." : "We could not process the request.");
  } catch (error) {
    console.error("Unable to send the UEI inquiry request.", error);
    feedback.textContent = "We could not reach the server. No request was confirmed.";
  } finally {
    submitting = false;
    submitButton.disabled = false;
    submitButton.textContent = "Submit request";
  }
});

try {
  const response = await fetch("/data/uei-campus-programs.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Availability request failed: ${response.status}`);
  availability = await response.json();
  updateCampusOptions();
} catch (error) {
  console.error("UEI availability could not be loaded.", error);
  noOptions.textContent = "Campus and program availability could not be loaded. Please try again later.";
  noOptions.hidden = false;
  campusSelect.disabled = true;
}

showStep(currentStep);
