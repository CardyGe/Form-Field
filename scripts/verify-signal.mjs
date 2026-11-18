// Build a GPU check app, then inspect its recorded results after opening it.
// node scripts/verify-signal.mjs             builds the check app
// node scripts/verify-signal.mjs --results   checks the completed GPU run
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
if (process.argv.includes('--results')) {
  const results=JSON.parse(await fs.readFile('work/signal-art-check/results.json','utf8'));
  assert.ok(results.length>=10,'GPU run did not finish');
  for(const result of results) { console.log(`${result.passed?'PASS':'FAIL'} ${result.name}`); assert.ok(result.passed,JSON.stringify(result)); }
  const errors=await fs.readFile('work/signal-art-check/errors.txt','utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;});
  assert.equal(errors,'','GPU run logged errors');
} else await import('./build-signal-preview.mjs');
