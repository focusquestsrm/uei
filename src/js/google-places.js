(function () {
  'use strict';

  if (!document.getElementById('address')) return;

  const stateKey = '__ueiGooglePlacesState';
  const state = window[stateKey] || {
    autocomplete: null,
    input: null,
    listener: null,
    scriptRequested: false
  };
  window[stateKey] = state;

  function publishValue(field, value) {
    if (!field || value === undefined || value === null) return;
    const text = String(value).trim();
    if (field.value === text) return;
    field.value = text;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setValue(id, value) {
    const field = document.getElementById(id);
    if (!field || !value) return false;
    publishValue(field, value);
    return true;
  }

  function componentValue(components, type, shortName) {
    const component = components.find(function (entry) { return entry.types && entry.types.includes(type); });
    return component ? (shortName ? component.short_name : component.long_name) : '';
  }

  function cityValue(components) {
    return componentValue(components, 'locality', false) ||
      componentValue(components, 'postal_town', false) ||
      componentValue(components, 'sublocality_level_1', false) ||
      componentValue(components, 'administrative_area_level_2', false);
  }

  function focusMissing(id) {
    const field = document.getElementById(id);
    if (field && typeof field.focus === 'function') field.focus();
  }

  function handlePlaceChanged(autocomplete) {
    try {
      const place = autocomplete.getPlace();
      const components = place && Array.isArray(place.address_components) ? place.address_components : [];
      if (components.length === 0) {
        const input = document.getElementById('address');
        if (input) input.dataset.selectionComplete = 'false';
        return;
      }

      const streetNumber = componentValue(components, 'street_number', false);
      const route = componentValue(components, 'route', false);
      const street = streetNumber && route ? streetNumber + ' ' + route : (route || streetNumber || '');
      const city = cityValue(components);
      const region = componentValue(components, 'administrative_area_level_1', true);
      const zip = componentValue(components, 'postal_code', false);
      const missing = [];

      if (street) {
        setValue('address', street);
      } else {
        const input = document.getElementById('address');
        if (input) publishValue(input, input.value);
        missing.push('address');
      }
      if (!setValue('city', city)) missing.push('city');
      if (!setValue('state', region)) missing.push('state');
      if (!setValue('zip', zip)) missing.push('zip');

      document.body && document.body.classList && document.body.classList.add('uei-address-selection-complete');
      if (missing.length) focusMissing(missing[0]);
    } catch (error) {
      document.body && document.body.classList && document.body.classList.add('uei-address-selection-complete');
      const input = document.getElementById('address');
      if (input) publishValue(input, input.value);
      focusMissing('address');
    }
  }

  function initializePlaces() {
    const input = document.getElementById('address');
    if (!input || !window.google || !window.google.maps || !window.google.maps.places || !window.google.maps.places.Autocomplete) return null;
    if (state.autocomplete && state.input === input) return state.autocomplete;

    if (state.listener && typeof state.listener.remove === 'function') state.listener.remove();
    state.listener = null;
    state.autocomplete = null;
    state.input = input;

    try {
      state.autocomplete = new window.google.maps.places.Autocomplete(input, {
        componentRestrictions: { country: 'us' },
        fields: ['address_components'],
        types: ['address']
      });
      state.listener = state.autocomplete.addListener('place_changed', function () {
        handlePlaceChanged(state.autocomplete);
      });
      return state.autocomplete;
    } catch (error) {
      state.autocomplete = null;
      return null;
    }
  }

  const input = document.getElementById('address');
  if (input) {
    input.addEventListener('input', function () {
      document.body && document.body.classList && document.body.classList.remove('uei-address-selection-complete');
    });
  }

  window.UEI_GOOGLE_PLACES = { initializePlaces, componentValue, cityValue, handlePlaceChanged };
  const key = String((window.UEI_RUNTIME_CONFIG && window.UEI_RUNTIME_CONFIG.googleMapsBrowserKey) || '').trim();
  if (!key) return;

  if (window.google && window.google.maps && window.google.maps.places && window.google.maps.places.Autocomplete) {
    initializePlaces();
    return;
  }
  if (state.scriptRequested) return;
  state.scriptRequested = true;

  const callbackName = '__ueiGooglePlacesReady';
  window[callbackName] = initializePlaces;
  const script = document.createElement('script');
  script.async = true;
  script.defer = true;
  script.dataset.ueiGooglePlaces = 'true';
  script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&libraries=places&callback=' + callbackName + '&loading=async&v=weekly';
  script.addEventListener('error', function () {
    state.scriptRequested = false;
    delete window[callbackName];
  });
  document.head.appendChild(script);
})();
