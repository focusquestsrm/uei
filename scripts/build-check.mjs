import { readFile } from "node:fs/promises";
import { validateAvailability } from "../src/js/availability.mjs";

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

const [preview, production] = await Promise.all([
  readJson("../src/data/uei-preview-campus-programs.json"),
  readJson("../netlify/data/uei-campus-programs.json")
]);
const problems = [
  ...validateAvailability(preview).map((problem) => `Preview: ${problem}`),
  ...validateAvailability(production).map((problem) => `Production: ${problem}`)
];

if (preview.previewOnly !== true) problems.push("Browser campus/program data must be preview-only.");
if (production.previewOnly !== false) problems.push("Server campus/program data must not be preview-only.");
if (production.campuses.length !== 0) {
  problems.push("Production campus/program data must remain empty until approved mappings are supplied.");
}
if (preview.campuses.length === 0) problems.push("Preview must include the guideline campus options.");
if (preview.campuses.some((campus) => !campus.id.startsWith("preview-campus-"))) {
  problems.push("Preview campus data must use internal preview identifiers.");
}

if (problems.length) {
  console.error("UEI campus/program configuration is invalid:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `Build configuration valid. ${preview.campuses.length} provisional preview campuses are available; production options remain empty and outbound submission stays disabled.`
  );
}
