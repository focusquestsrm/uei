'use strict';

const { resolveRuntime } = require('../../../src/js/availability');

function parseBodyText(rawText) {
  const text = String(rawText || '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}

function classifyCapScope(rawText) {
  const text = String(rawText || '').toLowerCase();
  if (!text) return null;
  if (text.includes('campus/program') || text.includes('campus and program') || text.includes('program cap') || /campus\s*\/\s*program/.test(text)) return 'campus-program';
  if (text.includes('campus cap') || (/campus/.test(text) && /cap/.test(text))) return 'campus';
  if (text.includes('campaign/offer') || text.includes('campaign cap') || text.includes('offer cap')) return 'campaign';
  if (text.includes('cap for')) return 'campaign';
  return null;
}

function applyCapPause(runtimeState, campusId, programId, responseText, options) {
  const settings = options || {};
  const state = runtimeState || { manualPauses: { campuses: {}, offerings: {} }, capPauses: { campuses: {}, offerings: {} } };
  const next = Object.assign({}, state);
  next.capPauses = Object.assign({ campuses: {}, offerings: {} }, state.capPauses || {});
  next.capPauses.campuses = Object.assign({}, next.capPauses.campuses || {});
  next.capPauses.offerings = Object.assign({}, next.capPauses.offerings || {});

  if (settings.testMode === true) return { changed: false, scope: null, runtimeState: next };

  const scope = classifyCapScope(responseText);
  if (!scope || scope === 'campaign') return { changed: false, scope, runtimeState: next };

  if (scope === 'campus') {
    next.capPauses.campuses[campusId] = false;
    return { changed: true, scope: 'campus', runtimeState: next };
  }

  const key = campusId + '/' + programId;
  next.capPauses.offerings[key] = false;
  return { changed: true, scope: 'campus-program', runtimeState: next };
}

function staleSelectionRejected(currentRuntime, campusId, programId, zip) {
  const runtime = resolveRuntime({ campuses: [], programs: [], offerings: [] }, currentRuntime || {});
  const campus = runtime.campuses[campusId];
  const offering = runtime.offerings[campusId + '/' + programId];
  if (!campus || !campus.active || !offering || !offering.active) return true;
  return false;
}

module.exports = {
  applyCapPause,
  classifyCapScope,
  parseBodyText,
  staleSelectionRejected
};
