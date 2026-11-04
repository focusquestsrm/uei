(function (root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.UEI_AVAILABILITY = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const EMPTY_SWITCH = Object.freeze({ campuses: Object.freeze({}), offerings: Object.freeze({}) });

  function clone(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function parseDate(value) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  function normalizeState(state) {
    const source = state && typeof state === 'object' ? state : {};
    const previous = Array.isArray(source.versions) ? source.versions : [];
    return {
      currentVersion: source.currentVersion || null,
      versions: previous.map(function (version) {
        return {
          id: String(version && version.id ? version.id : ''),
          effectiveDate: version && version.effectiveDate || null,
          expiresAt: version && version.expiresAt || null,
          campuses: version && version.campuses && typeof version.campuses === 'object' ? clone(version.campuses) : {},
          offerings: version && version.offerings && typeof version.offerings === 'object' ? clone(version.offerings) : {}
        };
      }),
      manualPauses: {
        campuses: source.manualPauses && source.manualPauses.campuses && typeof source.manualPauses.campuses === 'object' ? clone(source.manualPauses.campuses) : {},
        offerings: source.manualPauses && source.manualPauses.offerings && typeof source.manualPauses.offerings === 'object' ? clone(source.manualPauses.offerings) : {}
      },
      capPauses: {
        campuses: source.capPauses && source.capPauses.campuses && typeof source.capPauses.campuses === 'object' ? clone(source.capPauses.campuses) : {},
        offerings: source.capPauses && source.capPauses.offerings && typeof source.capPauses.offerings === 'object' ? clone(source.capPauses.offerings) : {}
      },
      pendingVersion: source.pendingVersion || null
    };
  }

  function effectiveAt(version, now) {
    if (!version || !version.id) return null;
    const effectiveDate = parseDate(version.effectiveDate);
    if (!effectiveDate) return null;
    const current = now || new Date();
    if (current < effectiveDate) return null;
    const expiry = parseDate(version.expiresAt);
    if (expiry && current >= expiry) return null;
    return version;
  }

  function chooseVersion(state, now) {
    const normalized = normalizeState(state);
    const current = now || new Date();
    const validVersions = normalized.versions.filter(function (version) {
      return Boolean(effectiveAt(version, current));
    }).sort(function (left, right) {
      return Date.parse(right.effectiveDate || 0) - Date.parse(left.effectiveDate || 0);
    });
    if (validVersions.length > 0) return validVersions[0];
    return null;
  }

  function applyPauseOverride(override, defaultValue) {
    if (override === false) return false;
    if (override === true) return true;
    return defaultValue;
  }

  function initialState(config) {
    const campuses = {};
    const offerings = {};
    (config && Array.isArray(config.campuses) ? config.campuses : []).forEach(function (campus) {
      campuses[campus.id] = campus.active !== false;
    });
    (config && Array.isArray(config.offerings) ? config.offerings : []).forEach(function (offering) {
      offerings[offering.campus + '/' + offering.program] = offering.active !== false;
    });
    return { campuses, offerings };
  }

  function resolveRuntime(config, state, now) {
    const normalized = normalizeState(state);
    const version = chooseVersion(normalized, now);
    const source = initialState(config);
    const campuses = {};
    const offerings = {};

    if (!version) {
      (config && Array.isArray(config.campuses) ? config.campuses : []).forEach(function (campus) {
        campuses[campus.id] = { active: false };
      });
      (config && Array.isArray(config.offerings) ? config.offerings : []).forEach(function (offering) {
        const key = offering.campus + '/' + offering.program;
        offerings[key] = { active: false };
      });
      return {
        currentVersion: null,
        effectiveDate: null,
        expiresAt: null,
        campuses: campuses,
        offerings: offerings,
        pendingVersion: normalized.pendingVersion || null,
        manualPauses: normalized.manualPauses,
        capPauses: normalized.capPauses
      };
    }

    (config && Array.isArray(config.campuses) ? config.campuses : []).forEach(function (campus) {
      const override = version && version.campuses && Object.prototype.hasOwnProperty.call(version.campuses, campus.id) ? version.campuses[campus.id] : null;
      const manual = normalized.manualPauses && normalized.manualPauses.campuses ? normalized.manualPauses.campuses[campus.id] : null;
      const cap = normalized.capPauses && normalized.capPauses.campuses ? normalized.capPauses.campuses[campus.id] : null;
      const value = applyPauseOverride(override, source.campuses[campus.id]);
      campuses[campus.id] = { active: applyPauseOverride(manual, applyPauseOverride(cap, value)) };
    });

    (config && Array.isArray(config.offerings) ? config.offerings : []).forEach(function (offering) {
      const key = offering.campus + '/' + offering.program;
      const override = version && version.offerings && Object.prototype.hasOwnProperty.call(version.offerings, key) ? version.offerings[key] : null;
      const manual = normalized.manualPauses && normalized.manualPauses.offerings ? normalized.manualPauses.offerings[key] : null;
      const cap = normalized.capPauses && normalized.capPauses.offerings ? normalized.capPauses.offerings[key] : null;
      const value = applyPauseOverride(override, source.offerings[key]);
      const campusOpen = campuses[offering.campus] ? campuses[offering.campus].active : true;
      offerings[key] = { active: campusOpen && applyPauseOverride(manual, applyPauseOverride(cap, value)) };
    });

    return {
      currentVersion: version && version.id ? version.id : null,
      effectiveDate: version && version.effectiveDate || null,
      expiresAt: version && version.expiresAt || null,
      campuses: campuses,
      offerings: offerings,
      pendingVersion: normalized.pendingVersion || null,
      manualPauses: normalized.manualPauses,
      capPauses: normalized.capPauses
    };
  }

  function validateImportedVersion(config, version) {
    const errors = [];
    const campusIds = new Set((config && Array.isArray(config.campuses) ? config.campuses : []).map(function (campus) { return campus.id; }));
    const programIds = new Set((config && Array.isArray(config.programs) ? config.programs : []).map(function (program) { return program.id; }));
    const offeringPairs = new Set((config && Array.isArray(config.offerings) ? config.offerings : []).map(function (offering) { return offering.campus + '/' + offering.program; }));

    if (!version || !version.id || !String(version.id).trim()) errors.push('Version id is required.');
    if (!version || !version.effectiveDate || !parseDate(version.effectiveDate)) errors.push('Version effectiveDate is required and must be a valid date.');
    if (version && version.campuses && typeof version.campuses === 'object') {
      Object.keys(version.campuses).forEach(function (campusId) {
        if (!campusIds.has(campusId)) errors.push('Unknown campus in version: ' + campusId);
        const value = version.campuses[campusId];
        if (value !== false && value !== true && value !== null && value !== undefined) errors.push('Campus override must be true or false: ' + campusId);
      });
    }
    if (version && version.offerings && typeof version.offerings === 'object') {
      Object.keys(version.offerings).forEach(function (key) {
        const [campusId, programId] = String(key).split('/');
        if (!campusIds.has(campusId) || !programIds.has(programId)) errors.push('Unknown offering in version: ' + key);
        if (!offeringPairs.has(key)) errors.push('Offering pair not present in config: ' + key);
        const value = version.offerings[key];
        if (value !== false && value !== true && value !== null && value !== undefined) errors.push('Offering override must be true or false: ' + key);
      });
    }
    return errors;
  }

  function diffRuntime(prevRuntime, nextRuntime) {
    const previousMap = prevRuntime && prevRuntime.campuses ? prevRuntime.campuses : {};
    const nextMap = nextRuntime && nextRuntime.campuses ? nextRuntime.campuses : {};
    const priorOfferings = prevRuntime && prevRuntime.offerings ? prevRuntime.offerings : {};
    const nextOfferings = nextRuntime && nextRuntime.offerings ? nextRuntime.offerings : {};
    const opened = [];
    const closed = [];

    Object.keys(nextMap).forEach(function (campusId) {
      const before = Boolean(previousMap[campusId] && previousMap[campusId].active);
      const after = Boolean(nextMap[campusId] && nextMap[campusId].active);
      if (!before && after) opened.push({ scope: 'campus', id: campusId });
      if (before && !after) closed.push({ scope: 'campus', id: campusId });
    });

    Object.keys(nextOfferings).forEach(function (key) {
      const before = Boolean(priorOfferings[key] && priorOfferings[key].active);
      const after = Boolean(nextOfferings[key] && nextOfferings[key].active);
      if (!before && after) opened.push({ scope: 'offering', id: key });
      if (before && !after) closed.push({ scope: 'offering', id: key });
    });

    return { opened, closed };
  }

  return Object.freeze({
    EMPTY_SWITCH,
    applyPauseOverride,
    chooseVersion,
    diffRuntime,
    effectiveAt,
    initialState,
    normalizeState,
    parseDate,
    resolveRuntime,
    validateImportedVersion
  });
});
