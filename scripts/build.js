'use strict';

const fs = require('fs');
const path = require('path');
const catalog = require('../src/js/catalog');
const availability = require('../src/js/availability');
const config = require('../config/campus-programs.json');
const runtimeState = require('../config/availability.json');

const root = path.join(__dirname, '..');
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

// Public values only: no secrets, no routing IDs, no campaign code.
const runtime = {
  metaPixelId: '1394019919533755',
  endpoint: '/.netlify/functions/submit-lead',
  thankYouPath: '/thank-you.html',
  availability: availableState
};

fs.writeFileSync(path.join(root, 'src', 'js', 'runtime-config.js'),
  'window.UEI_RUNTIME_CONFIG = Object.freeze(' + JSON.stringify(runtime) + ');\n', 'utf8');
fs.writeFileSync(path.join(root, 'src', 'js', 'runtime-availability.js'),
  'window.UEI_RUNTIME_AVAILABILITY = Object.freeze(' + JSON.stringify(availableState) + ');\n', 'utf8');
fs.writeFileSync(path.join(root, 'src', 'js', 'campus-choices.js'),
  'window.UEI_CHOICES = Object.freeze(' + JSON.stringify(choices) + ');\n', 'utf8');
console.log('Built public configuration: ' + choices.campuses.length + ' campuses.');
