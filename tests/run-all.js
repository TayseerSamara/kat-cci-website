// Runs every suite against a local copy of the site (or against BASE_SITE, e.g. the preview URL).
const { spawn } = require('child_process');
const { start } = require('./serve');

// Async spawn: the local server lives in this process and must keep serving while a suite runs.
const run = (file, env) => new Promise(resolve => {
  spawn(process.execPath, [file], { stdio: 'inherit', env }).on('exit', code => resolve(code));
});

(async () => {
  const site = process.env.BASE_SITE;
  const server = site ? null : await start(5058);
  const base = site || 'http://localhost:5058';
  let failed = 0;
  for (const suite of ['gtag.test.js', 'confirmed.test.js', 'staff.test.js', 'promo.test.js', 'booking.test.js']) {
    console.log('\n######## ' + suite + '  (' + base + ')');
    if (await run(__dirname + '/' + suite, { ...process.env, SITE: base }) !== 0) failed++;
  }
  if (server) server.close();
  console.log(failed ? `\n${failed} SUITE(S) FAILED` : '\nALL SUITES PASSED');
  process.exit(failed ? 1 : 0);
})();
