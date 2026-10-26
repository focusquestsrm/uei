import { readFile } from "node:fs/promises";
import { validateAvailability } from "../src/js/availability.mjs";

const availability = JSON.parse(
  await readFile(new URL("../src/data/uei-campus-programs.json", import.meta.url), "utf8")
);
const problems = validateAvailability(availability);

if (problems.length) {
  console.error("UEI campus/program configuration is invalid:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log("Build configuration valid. Preview-only availability has no outbound selections.");
}
