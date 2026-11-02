#!/usr/bin/env node
/* Polls the mock servers through the real compiled adapters and checks the outcome of every failure scenario.
 *   npm run compile && node scripts/mock-server.js &   (or let this script start it)
 *   node scripts/test-scenarios.js                                                                */
const { spawn } = require('child_process');
const path = require('path');
const { pollTarget } = require('../out/adapters');
const { emptyGpu, isGateway } = require('../out/docker');

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

// Gateways and load balancers must not become cards; real servers must.
const gw = [
  ['sglang-router', 'lmsysorg/sglang:latest', ['python3', '-m', 'sglang_router.launch_router', '--worker-urls', 'http://a:30000'], true],
  ['vllm-router', 'ghcr.io/vllm-project/production-stack/router:latest', ['/app/router'], true],
  ['edge', 'nginx:1.27', ['nginx', '-g', 'daemon off;'], true],
  ['llm-gateway', 'ghcr.io/berriai/litellm:main', ['--config', 'c.yaml'], true],
  ['qwen3', 'vllm/vllm-openai:latest', ['vllm', 'serve', 'Qwen/Qwen3-8B', '--port', '8000'], false],
  ['llama', 'lmsysorg/sglang:latest', ['python3', '-m', 'sglang.launch_server', '--model-path', 'org/router-model-8B'], false],
  ['glm', 'vllm/vllm-openai:latest', ['--model', 'zai-org/GLM-4.5-Air', '--tensor-parallel-size', '2'], false]
];
let gwFailed = 0;
for (const [name, image, args, expect] of gw) {
  const got = isGateway(name, image, args);
  if (got !== expect) gwFailed++;
  console.log(`${got === expect ? 'PASS' : 'FAIL'}  gateway-check ${name.padEnd(13)} -> ${got ? 'skipped' : 'monitored'}`);
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'mock-server.js')], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 700));
  let failed = gwFailed;
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
