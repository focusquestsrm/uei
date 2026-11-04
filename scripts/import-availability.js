'use strict';

const fs = require('fs');
const path = require('path');
const catalog = require('../src/js/catalog');
const availability = require('../src/js/availability');
const { publishRuntimeAvailability } = require('../netlify/functions/_shared/runtime-availability');

const root = path.join(__dirname, '..');
const FILE = (() => {
  const direct = process.argv.find((entry) => entry.startsWith('--file='));
  if (direct) return direct.split('=')[1];
  const index = process.argv.indexOf('--file');
  return index !== -1 ? process.argv[index + 1] : process.argv[2] || null;
})();
const APPLY = process.argv.includes('--apply');
const PUBLISH = process.argv.includes('--publish');
const PREVIEW = process.argv.includes('--preview');
const configPath = path.join(root, 'config', 'campus-programs.json');
const availabilityPath = path.join(root, 'config', 'availability.json');
const baseConfig = require(configPath);
const previousState = require(availabilityPath);

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(',').map((cell) => cell.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((cell) => cell.trim());
    const item = {};
    header.forEach((key, index) => { item[key] = values[index] || ''; });
    return item;
  });
}

function parseImportedFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (filePath.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.versions && Array.isArray(parsed.versions)) {
      const version = parsed.versions[parsed.versions.length - 1] || {};
      return {
        id: parsed.currentVersion || version.id || 'import',
        effectiveDate: version.effectiveDate || parsed.effectiveDate || new Date().toISOString(),
        expiresAt: version.expiresAt || parsed.expiresAt || null,
        campuses: version.campuses || parsed.campuses || {},
        offerings: version.offerings || parsed.offerings || {}
      };
    }
    return { id: parsed.id || parsed.version || 'import', effectiveDate: parsed.effectiveDate || new Date().toISOString(), expiresAt: parsed.expiresAt || null, campuses: parsed.campuses || {}, offerings: parsed.offerings || {} };
  }
  if (filePath.toLowerCase().endsWith('.csv')) {
    const rows = parseCsv(raw);
    const campuses = {};
    const offerings = {};
    rows.forEach((row) => {
      const campusId = (row.campus || row.campus_id || '').trim();
      const programId = (row.program || row.program_id || '').trim();
      const active = String(row.active || row.enabled || 'true').toLowerCase() !== 'false';
      if (campusId && !programId) campuses[campusId] = active;
      if (campusId && programId) offerings[campusId + '/' + programId] = active;
    });
    return { id: 'imported-version', effectiveDate: new Date().toISOString(), campuses, offerings };
  }
  throw new Error('Unsupported file type. Use .json or .csv.');
}

function printDiff(diff) {
  if (diff.opened.length === 0 && diff.closed.length === 0) {
    console.log('No campus or offering changes detected.');
    return;
  }
  console.log('Opened:');
  diff.opened.forEach((entry) => console.log('  - ' + entry.scope + ': ' + entry.id));
  console.log('Closed:');
  diff.closed.forEach((entry) => console.log('  - ' + entry.scope + ': ' + entry.id));
}

function resolveRuntimeStore() {
  try {
    const { getStore } = require('@netlify/blobs');
    return getStore({ name: 'uei-runtime-availability', consistency: 'strong' });
  } catch (error) {
    return null;
  }
}

if (!FILE) {
  console.error('Usage: node scripts/import-availability.js --file path/to/availability.json [--apply] [--publish]');
  process.exit(1);
}

const filePath = path.isAbsolute(FILE) ? FILE : path.resolve(root, FILE.replace(/^\.?\.?\//, ''));
const imported = parseImportedFile(filePath);
const errors = availability.validateImportedVersion(baseConfig, imported);
if (errors.length) {
  console.error('Import validation failed:');
  errors.forEach((entry) => console.error('  - ' + entry));
  process.exit(1);
}

const effectiveNow = availability.effectiveAt(imported, new Date());
const nextState = Object.assign({}, previousState, {
  pendingVersion: imported.id,
  versions: Array.isArray(previousState.versions) ? previousState.versions.concat(imported) : [imported]
});
if (effectiveNow) {
  nextState.currentVersion = imported.id;
}
const previousRuntime = availability.resolveRuntime(baseConfig, previousState, new Date());
const nextRuntime = availability.resolveRuntime(baseConfig, nextState, new Date());
const diff = availability.diffRuntime(previousRuntime, nextRuntime);
printDiff(diff);

if (APPLY) {
  fs.writeFileSync(availabilityPath, JSON.stringify(nextState, null, 2) + '\n', 'utf8');
  console.log('Saved staged availability version: ' + imported.id + '. This local file is not runtime publication; it is only a locally approved record until a separate runtime publish step is executed.');
  return;
}
if (PUBLISH) {
  const store = resolveRuntimeStore();
  if (!store) {
    console.error('Runtime publish requires a configured Netlify Blobs store.');
    process.exit(1);
  }
  const published = await publishRuntimeAvailability(nextState, { store, maxAttempts: 5 });
  if (published.status !== 'ok') {
    console.error('Runtime publish failed: ' + (published.error || 'unknown error'));
    process.exit(1);
  }
  console.log('Published runtime availability to the durable store for version ' + imported.id + '.');
  return;
}
console.log('Preview only. Use --preview to print this diff again, --apply to stage the version in the approved local configuration, or --publish to push the approved version into the durable runtime state.');
