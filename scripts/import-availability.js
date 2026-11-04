'use strict';

const fs = require('fs');
const path = require('path');
const catalog = require('../src/js/catalog');
const availability = require('../src/js/availability');
const runtimeAvailability = require('../netlify/functions/_shared/runtime-availability');

const root = path.join(__dirname, '..');
const TARGET = (() => {
  const direct = process.argv.find((entry) => entry.startsWith('--target='));
  if (direct) return direct.split('=')[1];
  const index = process.argv.indexOf('--target');
  return index !== -1 ? process.argv[index + 1] : null;
})();
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

function createMockStore(filePath) {
  const target = path.resolve(filePath || path.join(root, '.tmp', 'runtime-availability.mock-store.json'));
  const ensure = function () {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, JSON.stringify({ __meta__: { etag: null, updatedAt: null }, data: null }, null, 2) + '\n', 'utf8');
    }
  };
  return {
    async getWithMetadata(key) {
      ensure();
      const raw = fs.readFileSync(target, 'utf8');
      const parsed = raw ? JSON.parse(raw) : { __meta__: { etag: null }, data: null };
      if (!parsed || !parsed.data || key !== 'runtime-availability') return null;
      return { data: parsed.data, etag: parsed.__meta__ && parsed.__meta__.etag ? parsed.__meta__.etag : null };
    },
    async setJSON(key, value, options) {
      ensure();
      const raw = fs.readFileSync(target, 'utf8');
      const parsed = raw ? JSON.parse(raw) : { __meta__: { etag: null }, data: null };
      const exists = parsed && parsed.data ? parsed.__meta__ : { etag: null };
      if (options && options.onlyIfMatch && exists.etag && exists.etag !== options.onlyIfMatch) {
        return { modified: false, etag: exists.etag };
      }
      const etag = 'etag-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
      const payload = { __meta__: { etag, updatedAt: new Date().toISOString() }, data: JSON.parse(JSON.stringify(value)) };
      fs.writeFileSync(target, JSON.stringify(payload, null, 2) + '\n', 'utf8');
      return { modified: true, etag };
    }
  };
}

function resolveRuntimeStore() {
  if (TARGET) return createMockStore(TARGET);
  try {
    const { getStore } = require('@netlify/blobs');
    return getStore({ name: 'uei-runtime-availability', consistency: 'strong' });
  } catch (error) {
    return null;
  }
}

async function main() {
  if (!FILE) {
    console.error('Usage: node scripts/import-availability.js --file path/to/availability.json [--apply] [--publish] [--target path/mock-store.json]');
    process.exitCode = 1;
    return;
  }

  const filePath = path.isAbsolute(FILE) ? FILE : path.resolve(root, FILE.replace(/^\.?\.?\//, ''));
  const imported = parseImportedFile(filePath);
  const errors = availability.validateImportedVersion(baseConfig, imported);
  if (errors.length) {
    console.error('Import validation failed:');
    errors.forEach((entry) => console.error('  - ' + entry));
    process.exitCode = 1;
    return;
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
      console.error('Runtime publish requires a configured Netlify Blobs store or --target for a mock store.');
      process.exitCode = 1;
      return;
    }
    const published = await runtimeAvailability.publishRuntimeAvailability({
      currentVersion: effectiveNow ? imported.id : previousState.currentVersion || null,
      pendingVersion: imported.id,
      versions: [imported],
      manualPauses: previousState.manualPauses || { campuses: {}, offerings: {} },
      capPauses: previousState.capPauses || { campuses: {}, offerings: {} }
    }, { store, maxAttempts: 5 });
    if (published.status !== 'ok') {
      console.error('Runtime publish failed: ' + (published.error || 'unknown error'));
      process.exitCode = 1;
      return;
    }
    console.log('Published runtime availability to the durable store for version ' + imported.id + '.');
    return;
  }
  console.log('Preview only. Use --preview to print this diff again, --apply to stage the version in the approved local configuration, or --publish to push the approved version into the durable runtime state.');
}

main().catch((error) => {
  console.error('Import failed: ' + (error && error.message ? error.message : String(error)));
  process.exitCode = 1;
});
