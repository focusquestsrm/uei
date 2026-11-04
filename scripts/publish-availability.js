'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const script = path.join(__dirname, 'import-availability.js');
const result = spawnSync(process.execPath, [script, ...args, '--publish'], {
  stdio: 'inherit'
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
