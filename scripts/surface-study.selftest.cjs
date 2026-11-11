// Fault-injection tests of the QA harness itself. Only synthetic work snapshots change.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..'), study = path.join(root, 'work/surface-study');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function main() {
  const original = await fs.readFile(path.join(study, 'before-renderer.js'), 'utf8');
  const cases = [
    { name: 'hash', quick: true, code: original + '\n// intentionally corrupt bundle\n', hash: hash(original), reason: 'Frozen renderer bundle hash differs' },
    { name: 'static', code: original.replace('u.uPhase.value = localPhase;', 'u.uPhase.value = 0;'), reason: 'intended animated preset rendered static output' },
    { name: 'nonperiodic', code: original.replaceAll('-uPhase/TAU', '-uPhase*.123/TAU'), reason: 'seam step' },
    { name: 'shader-error', quick: true, code: original.replace('uniform vec3 uPalette[6];', 'uniform vec3 uPalette[6];\nthis_is_not_glsl;'), reason: 'gpu-error-report' },
  ];
  const report = [];
  for (const test of cases) {
    const label = 'selftest-' + test.name;
    await fs.writeFile(path.join(study, label + '-renderer.js'), test.code);
    await fs.writeFile(path.join(study, label + '-snapshot.json'), JSON.stringify({ frozenAt: new Date().toISOString(), injection: test.name, sourceFiles: [], bundleSha256: test.hash || hash(test.code) }, null, 2));
    const result = await new Promise((resolve, reject) => {
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(path.join(root, 'node_modules/.bin/electron'), [path.join(__dirname, 'surface-study.cjs'), '--label', label, '--reuse', ...(test.quick ? ['--quick'] : [])], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; const collect = b => { output = (output + b).slice(-1024*1024); };
      child.stdout.on('data', collect); child.stderr.on('data', collect); child.on('error', reject);
      child.on('close', code => resolve({ code, output }));
    });
    let expectedFailure = result.output.includes(test.reason);
    if (test.reason === 'gpu-error-report') {
      const gpuReport = JSON.parse(await fs.readFile(path.join(study, label, 'report.json'), 'utf8'));
      expectedFailure = gpuReport.status === 'failed' && gpuReport.gpuMessages.some(message => message.level === 'error');
    }
    if (result.code === 0 || !expectedFailure) throw new Error(`QA fault injection ${test.name} did not fail as expected:\n${result.output}`);
    report.push({ injection: test.name, exitCode: result.code, expectedFailureDetected: true });
    console.log('QA_SELFTEST_PASS ' + test.name);
  }
  await fs.writeFile(path.join(study, 'selftest-results.json'), JSON.stringify({ createdAt: new Date().toISOString(), tests: report }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
