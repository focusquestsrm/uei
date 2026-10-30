(function () {
  'use strict';

  const runtime = window.UEI_RUNTIME_CONFIG || {};
  const choices = window.UEI_CHOICES || { campuses: [] };
  const rules = window.UEI_RULES;
  const address = window.UEI_ADDRESS;
  const phone = window.UEI_PHONE;
  const catalog = window.UEI_CATALOG;
  const form = document.getElementById('lead-form');
  if (!form || !rules || !address || !phone || !catalog) return;

  const STORAGE_KEY = 'uei_submission';
  const MESSAGES = {
    campus: 'Please select a campus.',
    program: 'Please select a program.',
    education: 'Please select your education level.',
    gradYear: 'Please select a year from 1998 to 2024.',
    age: 'You must be at least 18 to continue.',
    gender: 'Please select an option.',
    military: 'Please select an option.',
    address: address.MESSAGES.address + ' (include the street number and name).',
    address2: address.MESSAGES.address2,
    city: address.MESSAGES.city,
    state: address.MESSAGES.state,
    zip: address.MESSAGES.zip,
    zipArea: 'This ZIP code is outside the area served by the selected campus. Choose a different campus or ZIP code.',
    firstName: 'Please enter at least 2 characters.',
    lastName: 'Please enter at least 2 characters.',
    email: 'Please enter a valid email address.',
    phone: phone.MESSAGE,
    startDate: 'Please select when you would like to start.',
    consent: 'Please check the box to continue.'
  };
  const STEP_FIELDS = {
    1: ['campus', 'program'],
    2: ['education', 'gradYear', 'age', 'gender', 'military', 'address', 'address2', 'city', 'state', 'zip'],
    3: ['firstName', 'lastName', 'email', 'phone', 'startDate', 'consent']
  };

  const status = document.getElementById('form-status');
  const submitButton = document.getElementById('submit-button');
  const campusSelect = form.elements.campus;
  const programSelect = form.elements.program;
  let currentStep = 1;
  let submitting = false;

  function option(select, value, label) {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = label;
    select.appendChild(element);
  }

  function fill(select, entries) {
    entries.forEach(function (entry) { option(select, entry.value, entry.label); });
  }

  function populate() {
    choices.campuses.forEach(function (campus) { option(campusSelect, campus.id, campus.name); });
    fill(form.elements.education, rules.EDUCATION_LEVELS.map(function (level) { return { value: level.value + '|' + level.id, label: level.label }; }));
    fill(form.elements.gradYear, rules.gradYears().map(function (year) { return { value: year, label: year }; }));
    fill(form.elements.gender, rules.GENDERS);
    fill(form.elements.military, rules.MILITARY);
    fill(form.elements.state, address.STATE_CODES.map(function (code) { return { value: code, label: code }; }));
    fill(form.elements.startDate, rules.START_DATES.map(function (entry) { return { value: entry, label: entry }; }));
  }

  function selectedCampus() {
    return choices.campuses.find(function (campus) { return campus.id === campusSelect.value; }) || null;
  }

  // Changing the campus always re-derives the program list and clears an unavailable selection.
  function refreshPrograms() {
    const previous = programSelect.value;
    const campus = selectedCampus();
    programSelect.innerHTML = '';
    if (!campus) {
      option(programSelect, '', 'Select a campus first');
      programSelect.disabled = true;
      return;
    }
    option(programSelect, '', 'Select a program');
    campus.programs.forEach(function (program) { option(programSelect, program.id, program.name); });
    programSelect.disabled = false;
    if (campus.programs.some(function (program) { return program.id === previous; })) programSelect.value = previous;
  }

  function renderCards() {
    const container = document.getElementById('program-cards');
    if (!container) return;
    const byProgram = new Map();
    choices.campuses.forEach(function (campus) {
      campus.programs.forEach(function (program) {
        if (!byProgram.has(program.id)) byProgram.set(program.id, { name: program.name, campuses: [] });
        byProgram.get(program.id).campuses.push(campus.name);
      });
    });
    byProgram.forEach(function (entry, id) {
      const card = document.createElement('article');
      card.className = 'program-card';
      card.dataset.program = id;
      const title = document.createElement('h3');
      title.textContent = entry.name;
      const places = document.createElement('p');
      places.textContent = 'Available at: ' + entry.campuses.join(', ');
      card.appendChild(title);
      card.appendChild(places);
      container.appendChild(card);
    });
  }

  function field(name) {
    return name === 'consent' ? form.elements['lead_consent[tcpa_consent]'] : form.elements[name];
  }

  function value(name) {
    const element = field(name);
    return element ? (element.type === 'checkbox' ? (element.checked ? 'Y' : '') : String(element.value).trim()) : '';
  }

  function setError(name, message) {
    const slot = form.querySelector('[data-error="' + name + '"]');
    const element = field(name);
    if (slot) {
      slot.hidden = !message;
      slot.textContent = message || '';
    }
    if (element) {
      element.setAttribute('aria-invalid', message ? 'true' : 'false');
      if (slot) element.setAttribute('aria-describedby', slot.id || (slot.id = 'error-' + name));
    }
  }

  function check(name) {
    const text = value(name);
    let message = '';
    if (name === 'campus') message = text ? '' : MESSAGES.campus;
    else if (name === 'program') message = text ? '' : MESSAGES.program;
    else if (name === 'education') message = text ? '' : MESSAGES.education;
    else if (name === 'gradYear') message = rules.isValidGradYear(text) ? '' : MESSAGES.gradYear;
    else if (name === 'age') message = rules.isValidAge(text) ? '' : MESSAGES.age;
    else if (name === 'gender') message = rules.isValidGender(text) ? '' : MESSAGES.gender;
    else if (name === 'military') message = rules.isValidMilitary(text) ? '' : MESSAGES.military;
    else if (name === 'address') message = address.isValidStreetAddress(text) ? '' : MESSAGES.address;
    else if (name === 'address2') message = address.isValidAddress2(text) ? '' : MESSAGES.address2;
    else if (name === 'city') message = address.isValidCity(text) ? '' : MESSAGES.city;
    else if (name === 'state') message = address.isValidStateCode(text) ? '' : MESSAGES.state;
    else if (name === 'zip') {
      const campus = selectedCampus();
      if (!address.isValidZipCode(text)) message = MESSAGES.zip;
      else if (campus && !catalog.zipEligible(campus, text)) message = MESSAGES.zipArea;
    } else if (name === 'firstName' || name === 'lastName') message = rules.isValidName(text) ? '' : MESSAGES[name];
    else if (name === 'email') message = rules.isValidEmail(text) ? '' : MESSAGES.email;
    else if (name === 'phone') message = phone.normalize(text) ? '' : MESSAGES.phone;
    else if (name === 'startDate') message = rules.isValidStartDate(text) ? '' : MESSAGES.startDate;
    else if (name === 'consent') message = text === 'Y' ? '' : MESSAGES.consent;
    setError(name, message);
    return !message;
  }

  function validateStep(step) {
    let firstInvalid = null;
    STEP_FIELDS[step].forEach(function (name) {
      if (!check(name) && !firstInvalid) firstInvalid = field(name);
    });
    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  function showStep(step) {
    currentStep = step;
    form.querySelectorAll('.step').forEach(function (element) { element.hidden = Number(element.dataset.step) !== step; });
    document.querySelectorAll('[data-progress]').forEach(function (element) {
      element.classList.toggle('active', Number(element.dataset.progress) <= step);
    });
    const first = form.querySelector('.step[data-step="' + step + '"] select, .step[data-step="' + step + '"] input');
    if (first && step > 1) first.focus();
  }

  function showStatus(message) {
    status.textContent = message || '';
    status.hidden = !message;
  }

  function newSubmissionId() {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return 'uei-' + Array.prototype.map.call(bytes, function (byte) { return ('0' + byte.toString(16)).slice(-2); }).join('');
  }

  // The id is kept until a definitive outcome so a retry of the same submission is recognized as a replay.
  function submissionId() {
    let id = null;
    try { id = window.sessionStorage.getItem(STORAGE_KEY); } catch (error) { id = null; }
    if (!id) {
      id = newSubmissionId();
      try { window.sessionStorage.setItem(STORAGE_KEY, id); } catch (error) { /* in-memory only */ }
    }
    return id;
  }

  function clearSubmissionId() {
    try { window.sessionStorage.removeItem(STORAGE_KEY); } catch (error) { /* ignore */ }
  }

  function cookie(name) {
    const match = document.cookie.split('; ').find(function (entry) { return entry.indexOf(name + '=') === 0; });
    return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
  }

  function attribution() {
    const params = new URLSearchParams(window.location.search);
    const data = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (name) {
      if (params.get(name)) data[name] = params.get(name);
    });
    const fbclid = params.get('fbclid') || '';
    // Inherited Back2Learn mapping: _fbc -> subid2, _fbp -> subid3, fbclid -> subid4.
    const fbc = cookie('_fbc') || (fbclid ? 'fb.1.' + Date.now() + '.' + fbclid : '');
    if (fbc) data.subid2 = fbc;
    if (cookie('_fbp')) data.subid3 = cookie('_fbp');
    if (fbclid) data.subid4 = fbclid;
    return data;
  }

  function payload() {
    const education = value('education').split('|')[0];
    const body = {
      submissionId: submissionId(),
      campus: value('campus'),
      program: value('program'),
      education,
      gradYear: value('gradYear'),
      age: value('age'),
      gender: value('gender'),
      military: value('military'),
      address: value('address'),
      address2: value('address2'),
      city: value('city'),
      state: value('state'),
      zip: value('zip'),
      firstName: value('firstName'),
      lastName: value('lastName'),
      email: value('email'),
      phone: value('phone'),
      startDate: value('startDate'),
      consent: value('consent'),
      leadIdToken: document.getElementById('leadid_token').value,
      consentUrl: window.location.origin + window.location.pathname
    };
    return Object.assign(body, attribution());
  }

  function goToThankYou(delay) {
    window.setTimeout(function () { window.location.assign(runtime.thankYouPath || '/thank-you.html'); }, delay);
  }

  function finish(response, httpOk) {
    const outcome = response && response.outcome;
    if (outcome === 'accepted' || outcome === 'rejected' || outcome === 'duplicate') {
      clearSubmissionId();
      // A Lead event is only meaningful for a live, first-time, accepted submission.
      const fire = httpOk && outcome === 'accepted' && response.testMode === false && response.replay !== true;
      if (fire && window.UEI_META && window.UEI_META.fireLead()) goToThankYou(1000);
      else goToThankYou(0);
      return;
    }
    if (outcome === 'invalid_request' || outcome === 'validation_error') {
      clearSubmissionId();
      showStatus('We could not accept some of your information. Please review your answers and try again.');
    } else if (outcome === 'closed') {
      // Nothing was sent or stored; the same submission id stays valid for a later attempt.
      showStatus(response.message || 'We are not accepting requests right now. Please try again later.');
    } else if (outcome === 'pending') {
      showStatus('Your request is still being processed. Please wait a moment before trying again.');
    } else {
      showStatus('We could not confirm your request right now. Please try again later.');
    }
    submitting = false;
    submitButton.disabled = false;
  }

  async function submit() {
    if (submitting) return;
    for (let step = 1; step <= 3; step += 1) {
      if (!validateStep(step)) {
        showStep(step);
        return;
      }
    }
    if (!rules.isValidLeadIdToken(document.getElementById('leadid_token').value)) {
      showStatus('Verification is still loading. Please wait a moment and press the button again.');
      return;
    }
    showStatus('');
    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting...';
    let response = null;
    let httpOk = false;
    try {
      const reply = await window.fetch(runtime.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload())
      });
      httpOk = reply.ok;
      response = await reply.json();
    } catch (error) {
      response = { outcome: 'unavailable' };
    }
    submitButton.textContent = 'Request Information';
    finish(response, httpOk);
  }

  populate();
  refreshPrograms();
  renderCards();

  campusSelect.addEventListener('change', function () {
    refreshPrograms();
    setError('campus', '');
    if (value('zip')) check('zip');
  });
  form.querySelectorAll('[data-next]').forEach(function (button) {
    button.addEventListener('click', function () { if (validateStep(currentStep)) showStep(currentStep + 1); });
  });
  form.querySelectorAll('[data-back]').forEach(function (button) {
    button.addEventListener('click', function () { showStep(currentStep - 1); });
  });
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    submit();
  });
  form.addEventListener('focusout', function (event) {
    const target = event.target;
    const name = target && (target.name === 'lead_consent[tcpa_consent]' ? 'consent' : target.name);
    if (name && STEP_FIELDS[currentStep].indexOf(name) !== -1 && value(name)) check(name);
  });
})();
