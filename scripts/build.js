'use strict';

const fs = require('fs');
const path = require('path');
const catalog = require('../src/js/catalog');
const availability = require('../src/js/availability');
const config = require('../config/campus-programs.json');
const runtimeState = require('../config/availability.json');

const bundledConfigDir = path.join(__dirname, '..', 'netlify', 'functions', '_shared', 'bundled-config');
fs.mkdirSync(bundledConfigDir, { recursive: true });
fs.writeFileSync(path.join(bundledConfigDir, 'campus-programs.json'), JSON.stringify(config, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(bundledConfigDir, 'availability.json'), JSON.stringify(runtimeState, null, 2) + '\n', 'utf8');

const root = path.join(__dirname, '..');
const googleMapsBrowserKey = String(process.env.GOOGLE_MAPS_BROWSER_KEY || '').trim();
if (googleMapsBrowserKey && !/^AIza[0-9A-Za-z_-]{20,}$/.test(googleMapsBrowserKey)) {
  throw new Error('GOOGLE_MAPS_BROWSER_KEY has an invalid format.');
}

const errors = catalog.validateConfig(config);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

const availableState = availability.resolveRuntime(config, runtimeState, new Date());
const choices = catalog.buildPublic(config, availableState);
if (!catalog.validatePublic(choices)) {
  console.error('No active campus and program choices are available.');
  process.exit(1);
}

// Public values only: no secrets, no routing IDs, no campaign code. Google Places browser
// key is intentionally exposed only to the browser so it can load the Autocomplete API.
const runtime = {
  metaPixelId: '1394019919533755',
  endpoint: '/.netlify/functions/submit-lead',
  availabilityEndpoint: '/.netlify/functions/availability',
  thankYouPath: '/thank-you.html',
  googleMapsBrowserKey: googleMapsBrowserKey,
  availability: availableState
};

fs.writeFileSync(path.join(root, 'src', 'js', 'runtime-config.js'),
  'window.UEI_RUNTIME_CONFIG = Object.freeze(' + JSON.stringify(runtime) + ');\n', 'utf8');
fs.writeFileSync(path.join(root, 'src', 'js', 'runtime-availability.js'),
  'window.UEI_RUNTIME_AVAILABILITY = Object.freeze(' + JSON.stringify(availableState) + ');\n', 'utf8');
fs.writeFileSync(path.join(root, 'src', 'js', 'campus-choices.js'),
  'window.UEI_CHOICES = Object.freeze(' + JSON.stringify(choices) + ');\n', 'utf8');
console.log('Built public configuration: ' + choices.campuses.length + ' campuses.');
