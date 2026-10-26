import {
  getActiveCampuses,
  getActivePrograms,
  getAvailableProgramNames
} from "./availability.mjs";
import { collectAttribution } from "./attribution.mjs";
import { normalizePhone } from "./phone.mjs";

const form = document.querySelector("#inquiry-form");
const campusSelect = document.querySelector("#campus");
const programSelect = document.querySelector("#program");
const stepPanels = [...document.querySelectorAll("[data-step-panel]")];
const stepCount = document.querySelector("#step-count");
const progressFill = document.querySelector("#step-progress-fill");
const feedback = document.querySelector("#form-feedback");
const continueButton = document.querySelector("#continue-button");
const backButton = document.querySelector("#back-button");
const submitButton = document.querySelector("#submit-button");
const restartButton = document.querySelector("#restart-button");
const phoneInput = document.querySelector("#phone");
const noOptions = document.querySelector("#no-options");
const availabilityNote = document.querySelector("#availability-note");
const programCardList = document.querySelector("#program-card-list");
const programLoadError = document.querySelector("#program-load-error");
const attribution = collectAttribution(window.location.search);
let availability = { previewOnly: true, campuses: [] };
let currentStep = 1;
let preferredProgram = "";
let completing = false;

const fields = {
  campusId: [campusSelect, document.querySelector("#campus-error")],
  programId: [programSelect, document.querySelector("#program-error")],
  firstName: [form.elements.namedItem("firstName"), document.querySelector("#first-name-error")],
  lastName: [form.elements.namedItem("lastName"), document.querySelector("#last-name-error")],
  email: [form.elements.namedItem("email"), document.querySelector("#email-error")],
  phone: [phoneInput, document.querySelector("#phone-error")],
  consent: [form.elements.namedItem("consent"), document.querySelector("#consent-error")]
};

function setFieldError(name, message) {
  const [field, error] = fields[name];
  field.setAttribute("aria-invalid", message ? "true" : "false");
  error.textContent = message;
}

function addOptions(select, values, placeholder) {
  select.replaceChildren(new Option(placeholder, ""));
  for (const item of values) select.add(new Option(item.name, item.id));
}

function showStep(step, { focus = true } = {}) {
  currentStep = step;
  for (const panel of stepPanels) panel.hidden = Number(panel.dataset.stepPanel) !== step;

  if (step === 3) {
    stepCount.textContent = "DONE";
    progressFill.style.width = "100%";
  } else {
    stepCount.firstChild.textContent = `0${step} `;
    progressFill.style.width = step === 1 ? "50%" : "100%";
  }
  backButton.hidden = step !== 2;
  continueButton.hidden = step !== 1;
  submitButton.hidden = step !== 2;
  if (focus) {
    const focusTarget = step === 1 ? campusSelect : step === 2 ? fields.firstName[0] : restartButton;
    focusTarget.focus();
  }
}

function updateProgramOptions() {
  const programs = getActivePrograms(availability, campusSelect.value);
  const placeholder = programs.length
    ? "Select a program"
    : campusSelect.value
      ? "No programs available"
      : "Select a campus first";
  addOptions(programSelect, programs, placeholder);
  programSelect.disabled = programs.length === 0;

  if (preferredProgram) {
    const matching = programs.find((program) => program.name === preferredProgram);
    if (matching) {
      programSelect.value = matching.id;
      availabilityNote.hidden = true;
    } else if (campusSelect.value) {
      availabilityNote.textContent = `${preferredProgram} is not listed for this campus in the preview. Choose another campus or explore the program options shown below.`;
      availabilityNote.hidden = false;
    }
  }

  if (campusSelect.value && programs.length === 0) {
    noOptions.textContent = "No programs are currently listed for this campus in the preview.";
    noOptions.hidden = false;
  } else {
    noOptions.hidden = getActiveCampuses(availability).length > 0;
  }
}

function updateCampusOptions() {
  const campuses = getActiveCampuses(availability);
  addOptions(campusSelect, campuses, "Select a campus");
  campusSelect.disabled = campuses.length === 0;
  programSelect.disabled = true;
  noOptions.textContent = campuses.length
    ? "No programs are currently listed for this campus in the preview."
    : "No eligible campus or program options are available in this preview.";
  noOptions.hidden = campuses.length > 0;
  updateProgramOptions();
}

function renderProgramCards() {
  const names = getAvailableProgramNames(availability);
  programCardList.replaceChildren();
  programLoadError.hidden = names.length > 0;
  if (!names.length) {
    programLoadError.textContent = "Program information could not be loaded. Please refresh to try again.";
    return;
  }

  for (const [index, name] of names.entries()) {
    const card = document.createElement("article");
    card.className = "program-card";

    const top = document.createElement("div");
    top.className = "program-card-top";
    const number = document.createElement("span");
    number.className = "program-index";
    number.textContent = String(index + 1).padStart(2, "0");
    const symbol = document.createElement("span");
    symbol.className = "program-symbol";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = name.slice(0, 1).toUpperCase();
    top.append(number, symbol);

    const title = document.createElement("h3");
    title.textContent = name;
    const choose = document.createElement("button");
    choose.type = "button";
    choose.innerHTML = "Explore this program <span aria-hidden=\"true\">→</span>";
    choose.addEventListener("click", () => {
      preferredProgram = name;
      availabilityNote.hidden = true;
      document.querySelector("#inquiry-form").scrollIntoView({ behavior: "smooth", block: "center" });
      campusSelect.focus({ preventScroll: true });
      campusSelect.value = "";
      programSelect.value = "";
      updateProgramOptions();
    });

    card.append(top, title, choose);
    programCardList.append(card);
  }
}

function validateSelection() {
  const campusPrograms = getActivePrograms(availability, campusSelect.value);
  const campusError = !getActiveCampuses(availability).length
    ? "No campus options are currently available."
    : campusSelect.value
      ? ""
      : "Select an available campus.";
  const programError = campusPrograms.length === 0
    ? "No programs are currently listed for this campus."
    : campusPrograms.some((program) => program.id === programSelect.value)
      ? ""
      : "Select a program available at this campus.";
  setFieldError("campusId", campusError);
  setFieldError("programId", programError);
  return !campusError && !programError;
}

function validateContact() {
  let valid = true;
  for (const [name, label] of [["firstName", "first"], ["lastName", "last"]]) {
    const value = fields[name][0].value.trim();
    const error = value && value.length <= 100 ? "" : `Enter your ${label} name.`;
    setFieldError(name, error);
    valid = valid && !error;
  }

  const email = fields.email[0].value.trim();
  const emailError = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
    ? ""
    : "Enter a valid email address.";
  setFieldError("email", emailError);
  valid = valid && !emailError;

  const normalizedPhone = normalizePhone(phoneInput.value);
  const phoneError = normalizedPhone ? "" : "Enter a valid 10-digit U.S. phone number.";
  setFieldError("phone", phoneError);
  if (normalizedPhone) phoneInput.value = normalizedPhone;
  valid = valid && !phoneError;

  const consentError = fields.consent[0].checked ? "" : "Consent is required to continue this preview.";
  setFieldError("consent", consentError);
  return valid && !consentError;
}

function focusFirstInvalid() {
  form.querySelector('[aria-invalid="true"]')?.focus();
}

campusSelect.addEventListener("change", () => {
  programSelect.value = "";
  for (const field of ["campusId", "programId"]) setFieldError(field, "");
  updateProgramOptions();
});

programSelect.addEventListener("change", () => {
  if (programSelect.value) {
    const selected = getActivePrograms(availability, campusSelect.value)
      .find((program) => program.id === programSelect.value);
    if (selected?.name !== preferredProgram) preferredProgram = "";
  }
  setFieldError("programId", "");
});

continueButton.addEventListener("click", () => {
  feedback.textContent = "";
  if (!validateSelection()) {
    focusFirstInvalid();
    return;
  }
  showStep(2);
});

backButton.addEventListener("click", () => {
  feedback.textContent = "";
  showStep(1);
});

for (const [name, [field]] of Object.entries(fields)) {
  field.addEventListener("input", () => setFieldError(name, ""));
  field.addEventListener("change", () => setFieldError(name, ""));
}

phoneInput.addEventListener("blur", () => {
  const normalized = normalizePhone(phoneInput.value);
  const error = phoneInput.value.trim() && !normalized ? "Enter a valid 10-digit U.S. phone number." : "";
  setFieldError("phone", error);
  if (normalized) phoneInput.value = normalized;
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (completing) return;
  feedback.textContent = "";
  if (!validateContact()) {
    focusFirstInvalid();
    return;
  }
  if (!validateSelection() || availability.previewOnly !== true) {
    feedback.textContent = "This review is not configured for lead submission. No inquiry was sent.";
    return;
  }

  completing = true;
  submitButton.disabled = true;
  submitButton.textContent = "Finishing preview…";
  const campus = getActiveCampuses(availability).find((item) => item.id === campusSelect.value);
  const program = getActivePrograms(availability, campusSelect.value).find((item) => item.id === programSelect.value);
  document.querySelector("#completion-summary").textContent =
    `${program.name} at ${campus.name} is your selected preview option.`;
  showStep(3);
  completing = false;
});

restartButton.addEventListener("click", () => {
  form.reset();
  preferredProgram = "";
  availabilityNote.hidden = true;
  feedback.textContent = "";
  submitButton.disabled = false;
  submitButton.innerHTML = "Finish preview <span aria-hidden=\"true\">→</span>";
  for (const name of Object.keys(fields)) setFieldError(name, "");
  updateCampusOptions();
  showStep(1);
});

async function loadPreview() {
  const response = await fetch("/data/uei-preview-campus-programs.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Preview data request failed: ${response.status}`);
  const data = await response.json();
  const { validateAvailability } = await import("./availability.mjs");
  const errors = validateAvailability(data);
  if (errors.length || data.previewOnly !== true) {
    throw new Error(`Invalid UEI preview data: ${errors.join(" ") || "previewOnly must be true."}`);
  }
  availability = data;
  updateCampusOptions();
  renderProgramCards();
  void attribution;
}

try {
  await loadPreview();
} catch (error) {
  console.error("UEI preview data could not be loaded.", error);
  programLoadError.textContent = "Campus and program preview could not be loaded. Please refresh to try again.";
  programLoadError.hidden = false;
  campusSelect.disabled = true;
  programSelect.disabled = true;
}

showStep(currentStep, { focus: false });
