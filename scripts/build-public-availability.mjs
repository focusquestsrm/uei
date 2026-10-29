import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateAvailability } from '../src/js/availability.mjs';

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
}

const production = await readJson('../netlify/data/uei-campus-programs.json');
const publicProjection = {
  ...production,
  previewOnly: false,
  publicProjection: true,
  campuses: production.campuses.map((campus) => ({
    ...campus,
    programs: campus.programs.map((program) => {
      const { leadHoopId: _leadHoopId, ...publicProgram } = program;
      return publicProgram;
    })
  }))
};

const sanitizedCampuses = publicProjection.campuses.map((campus) => {
  const { leadHoopId: _leadHoopId, ...publicCampus } = campus;
  return {
    ...publicCampus,
    programs: publicCampus.programs.map((program) => {
      const { leadHoopId: _leadHoopProgramId, ...cleanProgram } = program;
      return cleanProgram;
    })
  };
});

const cleanProjection = {
  ...publicProjection,
  campuses: sanitizedCampuses
};

const errors = validateAvailability(cleanProjection);
if (errors.length) {
  console.error('Public campus/program projection is invalid:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
  process.exit();
}

const target = fileURLToPath(new URL('../src/data/uei-public-campus-programs.json', import.meta.url));
await writeFile(target, `${JSON.stringify(cleanProjection, null, 2)}\n`, 'utf8');
console.log(`Generated public campus/program projection with ${cleanProjection.campuses.length} campuses.`);
