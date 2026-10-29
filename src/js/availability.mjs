export function validateAvailability(value) {
  const errors = [];
  if (!value || typeof value !== "object" || !Array.isArray(value.campuses)) {
    return ["Configuration must contain a campuses array."];
  }
  if (typeof value.previewOnly !== "boolean") {
    errors.push("Configuration must set previewOnly to true or false.");
  }

  const isPublicProjection = Boolean(value.publicProjection === true);
  const campusIds = new Set();
  const campusOrders = new Set();
  const allProgramIds = new Set();
  for (const campus of value.campuses) {
    if (!campus || typeof campus.id !== "string" || !campus.id.trim()) {
      errors.push("Each campus must have a stable, non-empty id.");
      continue;
    }
    if (campusIds.has(campus.id)) errors.push(`Campus id "${campus.id}" is duplicated.`);
    campusIds.add(campus.id);
    if (value.previewOnly && !campus.id.startsWith("preview-campus-")) {
      errors.push(`Preview campus id "${campus.id}" must use the preview-campus- prefix.`);
    }
    if (!value.previewOnly && campus.id.startsWith("preview-")) {
      errors.push(`Production campus id "${campus.id}" cannot use the preview- prefix.`);
    }
    if (typeof campus.name !== "string" || !campus.name.trim()) {
      errors.push(`Campus "${campus.id}" must have a name.`);
    }
    if (!Number.isInteger(campus.displayOrder) || campus.displayOrder < 1) {
      errors.push(`Campus "${campus.id}" must have a positive displayOrder.`);
    }
    if (campusOrders.has(campus.displayOrder)) {
      errors.push(`Campus displayOrder "${campus.displayOrder}" is duplicated.`);
    }
    campusOrders.add(campus.displayOrder);
    if (typeof campus.active !== "boolean") errors.push(`Campus "${campus.id}" must set active.`);
    if (!value.previewOnly && !isPublicProjection && campus.active && !isConfirmedMapping(campus.leadHoopId)) {
      errors.push(`Active production campus "${campus.id}" requires a confirmed LeadHoop mapping.`);
    }
    if (value.previewOnly && Object.hasOwn(campus, "leadHoopId")) {
      errors.push(`Preview campus "${campus.id}" cannot contain a LeadHoop mapping.`);
    }
    if (!Array.isArray(campus.programs)) {
      errors.push(`Campus "${campus.id}" must contain a programs array.`);
      continue;
    }

    const programOrders = new Set();
    for (const program of campus.programs) {
      if (!program || typeof program.id !== "string" || !program.id.trim()) {
        errors.push(`Campus "${campus.id}" has a program without a stable id.`);
        continue;
      }
      if (allProgramIds.has(program.id)) {
        errors.push(`Program id "${program.id}" is duplicated.`);
      }
      allProgramIds.add(program.id);
      if (value.previewOnly && !program.id.startsWith("preview-program-")) {
        errors.push(`Preview program id "${program.id}" must use the preview-program- prefix.`);
      }
      if (!value.previewOnly && program.id.startsWith("preview-")) {
        errors.push(`Production program id "${program.id}" cannot use the preview- prefix.`);
      }
      if (typeof program.name !== "string" || !program.name.trim()) {
        errors.push(`Program "${program.id}" in campus "${campus.id}" must have a name.`);
      }
      if (!Number.isInteger(program.displayOrder) || program.displayOrder < 1) {
        errors.push(`Program "${program.id}" in campus "${campus.id}" must have a positive displayOrder.`);
      }
      if (programOrders.has(program.displayOrder)) {
        errors.push(`Program displayOrder "${program.displayOrder}" is duplicated in campus "${campus.id}".`);
      }
      programOrders.add(program.displayOrder);
      if (typeof program.active !== "boolean") {
        errors.push(`Program "${program.id}" in campus "${campus.id}" must set active.`);
      }
      if (!value.previewOnly && !isPublicProjection && campus.active && program.active && !isConfirmedMapping(program.leadHoopId)) {
        errors.push(`Active production program "${program.id}" requires a confirmed LeadHoop mapping.`);
      }
      if (value.previewOnly && Object.hasOwn(program, "leadHoopId")) {
        errors.push(`Preview program "${program.id}" cannot contain a LeadHoop mapping.`);
      }
    }
  }
  return errors;
}

function isConfirmedMapping(value) {
  return typeof value === "string" && value.trim().length > 0 && !/^replace|placeholder|todo$/i.test(value.trim());
}

export function getActiveCampuses(availability) {
  if (!availability || !Array.isArray(availability.campuses)) return [];
  return availability.campuses
    .filter((campus) => campus.active === true)
    .sort((left, right) => left.displayOrder - right.displayOrder);
}

export function getActivePrograms(availability, campusId) {
  const campus = getActiveCampuses(availability).find((item) => item.id === campusId);
  return campus
    ? campus.programs
        .filter((program) => program.active === true)
        .sort((left, right) => left.displayOrder - right.displayOrder)
    : [];
}

export function getAvailableProgramNames(availability) {
  const names = new Set();
  for (const campus of getActiveCampuses(availability)) {
    for (const program of getActivePrograms(availability, campus.id)) {
      names.add(program.name);
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

export function isActiveProductionPair(availability, campusId, programId) {
  if (!availability || availability.previewOnly !== false) return false;
  if (campusId.startsWith("preview-") || programId.startsWith("preview-")) return false;
  const campus = getActiveCampuses(availability).find((item) => item.id === campusId);
  return Boolean(
    campus &&
      isConfirmedMapping(campus.leadHoopId) &&
      campus.programs.some(
        (program) =>
          program.id === programId &&
          program.active === true &&
          isConfirmedMapping(program.leadHoopId)
      )
  );
}
