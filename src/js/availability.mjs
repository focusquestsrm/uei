export function validateAvailability(value) {
  const errors = [];
  if (!value || typeof value !== "object" || !Array.isArray(value.campuses)) {
    return ["Configuration must contain a campuses array."];
  }
  if (typeof value.previewOnly !== "boolean") {
    errors.push("Configuration must set previewOnly to true or false.");
  }

  const campusIds = new Set();
  const campusOrders = new Set();
  for (const campus of value.campuses) {
    if (!campus || typeof campus.id !== "string" || !campus.id.trim()) {
      errors.push("Each campus must have a stable, non-empty id.");
      continue;
    }
    if (campusIds.has(campus.id)) errors.push(`Campus id "${campus.id}" is duplicated.`);
    campusIds.add(campus.id);
    if (typeof campus.name !== "string" || !campus.name.trim()) {
      errors.push(`Campus "${campus.id}" must have a name.`);
    }
    if (!Number.isInteger(campus.displayOrder) || campus.displayOrder < 1) {
      errors.push(`Campus "${campus.id}" must have a positive displayOrder.`);
    }
    if (campusOrders.has(campus.displayOrder)) errors.push(`Campus displayOrder "${campus.displayOrder}" is duplicated.`);
    campusOrders.add(campus.displayOrder);
    if (typeof campus.active !== "boolean") errors.push(`Campus "${campus.id}" must set active.`);
    if (!Array.isArray(campus.programs)) {
      errors.push(`Campus "${campus.id}" must contain a programs array.`);
      continue;
    }

    const programIds = new Set();
    const programOrders = new Set();
    for (const program of campus.programs) {
      if (!program || typeof program.id !== "string" || !program.id.trim()) {
        errors.push(`Campus "${campus.id}" has a program without a stable id.`);
        continue;
      }
      if (programIds.has(program.id)) {
        errors.push(`Program id "${program.id}" is duplicated in campus "${campus.id}".`);
      }
      programIds.add(program.id);
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
    }
  }
  return errors;
}

export function getActiveCampuses(availability) {
  if (!availability || availability.previewOnly === true || !Array.isArray(availability.campuses)) return [];
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
