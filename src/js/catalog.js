(function (root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.UEI_CATALOG = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const NUMERIC = /^\d{1,12}$/;

  function byOrder(left, right) {
    return left.displayOrder - right.displayOrder;
  }

  // Strict structural validation of the maintained source (config/campus-programs.json).
  function validateConfig(config) {
    const errors = [];
    const fail = function (message) { errors.push(message); };
    if (!config || !Array.isArray(config.campuses) || !Array.isArray(config.programs) || !Array.isArray(config.offerings)) {
      return ['Catalog must contain campuses, programs, and offerings arrays.'];
    }
    const campusIds = new Set();
    const campusRouting = new Set();
    const campusOrders = new Set();
    config.campuses.forEach(function (campus) {
      if (!SLUG.test(String(campus.id || ''))) fail('Invalid campus id: ' + campus.id);
      if (campusIds.has(campus.id)) fail('Duplicate campus id: ' + campus.id);
      if (!NUMERIC.test(String(campus.leadHoopId || '')) || campusRouting.has(campus.leadHoopId)) fail('Invalid or duplicate campus routing ID: ' + campus.id);
      if (!String(campus.name || '').trim()) fail('Blank campus name: ' + campus.id);
      if (typeof campus.active !== 'boolean') fail('Campus active must be boolean: ' + campus.id);
      if (!Number.isInteger(campus.displayOrder) || campusOrders.has(campus.displayOrder)) fail('Invalid or duplicate campus display order: ' + campus.id);
      if (!Array.isArray(campus.zips) || campus.zips.some(function (zip) { return !/^\d{5}$/.test(zip); })) fail('Campus ZIPs must be five-digit strings: ' + campus.id);
      campusIds.add(campus.id);
      campusRouting.add(campus.leadHoopId);
      campusOrders.add(campus.displayOrder);
    });
    const programIds = new Set();
    const programOrders = new Set();
    config.programs.forEach(function (program) {
      if (!SLUG.test(String(program.id || ''))) fail('Invalid program id: ' + program.id);
      if (programIds.has(program.id)) fail('Duplicate program id: ' + program.id);
      if (!NUMERIC.test(String(program.leadHoopId || ''))) fail('Invalid program routing ID: ' + program.id);
      if (!String(program.name || '').trim()) fail('Blank program name: ' + program.id);
      if (!Number.isInteger(program.displayOrder) || programOrders.has(program.displayOrder)) fail('Invalid or duplicate program display order: ' + program.id);
      programIds.add(program.id);
      programOrders.add(program.displayOrder);
    });
    const pairs = new Set();
    config.offerings.forEach(function (offering) {
      const pair = offering.campus + '/' + offering.program;
      if (!campusIds.has(offering.campus) || !programIds.has(offering.program)) fail('Offering references an unknown campus or program: ' + pair);
      if (typeof offering.active !== 'boolean') fail('Offering active must be boolean: ' + pair);
      if (pairs.has(pair)) fail('Duplicate offering: ' + pair);
      pairs.add(pair);
    });
    return errors;
  }

  function findOffering(config, campusId, programId) {
    return config.offerings.find(function (offering) { return offering.campus === campusId && offering.program === programId; }) || null;
  }

  function zipEligible(campus, zip) {
    return typeof zip === 'string' && campus.zips.indexOf(zip) !== -1;
  }

  // Authoritative server-side resolution. A campus/program pair is only usable when the campus,
  // the offering, and the ZIP all qualify at the time of the request.
  function resolveSelection(config, campusId, programId, zip) {
    const campus = config.campuses.find(function (entry) { return entry.id === campusId; });
    const program = config.programs.find(function (entry) { return entry.id === programId; });
    const offering = campus && program ? findOffering(config, campus.id, program.id) : null;
    if (!campus || !program || !offering) return { ok: false, reason: 'unknown' };
    if (!campus.active || !offering.active) return { ok: false, reason: 'paused' };
    if (!zipEligible(campus, zip)) return { ok: false, reason: 'zip' };
    return { ok: true, campus, program };
  }

  // Sanitized browser projection: only active choices, no routing IDs, no pause metadata.
  function buildPublic(config) {
    const programs = config.programs.slice().sort(byOrder);
    const campuses = config.campuses.slice().sort(byOrder).map(function (campus) {
      const offered = campus.active ? programs.filter(function (program) {
        const offering = findOffering(config, campus.id, program.id);
        return offering && offering.active;
      }) : [];
      return {
        id: campus.id,
        name: campus.name,
        zips: campus.zips.slice(),
        programs: offered.map(function (program) { return { id: program.id, name: program.name }; })
      };
    }).filter(function (campus) { return campus.programs.length > 0; });
    return { campuses };
  }

  function validatePublic(data) {
    return Boolean(data && Array.isArray(data.campuses) && data.campuses.length > 0 && data.campuses.every(function (campus) {
      return typeof campus.id === 'string' && typeof campus.name === 'string' && Array.isArray(campus.zips) &&
        Array.isArray(campus.programs) && campus.programs.length > 0 && campus.programs.every(function (program) {
          return typeof program.id === 'string' && typeof program.name === 'string';
        });
    }));
  }

  return Object.freeze({ validateConfig, resolveSelection, buildPublic, validatePublic, zipEligible });
});
