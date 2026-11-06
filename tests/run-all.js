'use strict';
/* tests/run-all.js — runs the unit suite; with --browser also runs the headless Chromium suite. */
const { spawnSync } = require('child_process');
const path = require('path');

const suites = ['unit.test.js'];
if (process.argv.includes('--browser')) suites.push('browser.test.js');

let failed = false;
for (const suite of suites) {
  console.log(`\n▶ ${suite}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, suite)], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}
console.log(failed ? '\nTests FAILED' : '\nAll test suites passed');
process.exit(failed ? 1 : 0);
