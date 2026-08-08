/* Every check, in order of how long it takes.
 *
 *     node test/run-all.js            the fast ones (~10s)
 *     node test/run-all.js --slow     everything, including the measurements
 *
 * These slice the REAL functions out of lab.js / computers.js / builder.js and
 * run them against the vendored config/math/rules, so they test what ships. No
 * dependencies, no browser.
 *
 * ⚠️ They slice by SIGNATURE — `function venturePotential(pile, pool` and the
 * like. Rename or re-sign one of those functions and the harness will fail
 * loudly with "slice not found" (or, if you are unlucky, load nothing and throw
 * a ReferenceError). That has happened twice; it is the price of testing the
 * shipped source rather than a copy.
 */
const { execFileSync } = require('child_process');
const path = require('path');

const FAST = [
  ['pot_check.js',       'potential: whose hand, whose discards'],
  ['discard_check.js',   'potential: the discard-top timing rule'],
  ['handorder_check.js', 'hands ordered by colour potential'],
  ['assist_check.js',    'projected turns + the Assistant'],
  ['pick_check.js',      'pick draw: the reorder contract'],
  ['build_check.js',     'the build-a-computer language'],
  ['opponent_check.js',  'playing a computer on the board'],
];
const SLOW = [
  ['realist_check.js',   'reachable potential + The Patient, 400 paired games'],
  ['duel_check.js',      'the duel harness + The Broker, 120 games a matchup'],
];

const slow = process.argv.indexOf('--slow') >= 0;
const list = slow ? FAST.concat(SLOW) : FAST;
let failed = 0;

for (const [file, what] of list){
  process.stdout.write('· ' + file.padEnd(20) + what + ' … ');
  try {
    execFileSync(process.execPath, [path.join(__dirname, file)], { stdio: 'pipe' });
    console.log('ok');
  } catch (e){
    failed++;
    console.log('FAILED');
    process.stdout.write(String(e.stdout || '').split('\n').filter(l => /FAIL|Error/.test(l)).join('\n') + '\n');
  }
}

if (!slow) console.log('\n(measurement suites skipped — run with --slow, they take a few minutes)');
console.log(failed ? '\n' + failed + ' suite(s) FAILED' : '\nall suites passed');
process.exit(failed ? 1 : 0);
