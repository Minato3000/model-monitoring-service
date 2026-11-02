#!/usr/bin/env node
/* Polls the mock servers through the real compiled adapters and checks the outcome of every failure scenario.
 *   npm run compile && node scripts/mock-server.js &   (or let this script start it)
 *   node scripts/test-scenarios.js                                                                */
const { spawn } = require('child_process');
const path = require('path');
const { pollTarget } = require('../out/adapters');
const { emptyGpu } = require('../out/docker');

const expectations = {
  'ok-vllm':      s => s.status === 'ok' && !s.offline,
  'ok-sglang':    s => s.status === 'ok' && !s.offline,
  'no-metrics':   s => s.status === 'warn' && s.errorKind === 'nometrics',
  'bad-key':      s => s.status === 'error' && s.errorKind === 'auth',
  'slow':         s => s.status === 'error' && s.errorKind === 'timeout',
  'junk-metrics': s => s.status === 'ok' && Number.isFinite(s.kvUtil ?? 0),
  'refused':      s => s.status === 'error' && s.errorKind === 'refused',
  'bad-url':      s => s.status === 'error' && s.errorKind === 'other'
};
const ports = { 'ok-vllm': 9001, 'ok-sglang': 9002, 'no-metrics': 9003, 'bad-key': 9004, 'slow': 9005, 'junk-metrics': 9008, 'refused': 9099 };

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'mock-server.js')], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 700));
  let failed = 0;
  const targets = Object.keys(expectations).map(name => ({
    key: name, name, engine: name === 'ok-sglang' ? 'sglang' : 'vllm',
    baseUrl: name === 'bad-url' ? 'not a url' : `http://127.0.0.1:${ports[name]}`
  }));
  // two rounds so rate/delta logic and the "keep last good values" path both run
  for (let round = 0; round < 2; round++) {
    const snaps = await Promise.all(targets.map(t => pollTarget(t, '/nonexistent.sock', emptyGpu())));
    if (round === 1) {
      for (const s of snaps) {
        const ok = expectations[s.key](s);
        if (!ok) failed++;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.key.padEnd(13)} status=${s.status} kind=${s.errorKind ?? '-'} offline=${!!s.offline}  ${s.message ?? ''}`);
      }
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  srv.kill();
  console.log(failed ? `\n${failed} scenario(s) failed` : '\nAll scenarios behave as expected');
  process.exit(failed ? 1 : 0);
})();
