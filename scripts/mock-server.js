#!/usr/bin/env node
/* Fake vLLM / SGLang servers for exercising every happy and failure path of the monitor.
 *
 *   node scripts/mock-server.js
 *
 * Then add the printed URLs to "llmmonitor.extraEndpoints" (or run scripts/test-scenarios.js).
 * Port 9099 is deliberately left closed to give "connection refused". */
const http = require('http');

const T0 = Date.now();
const secs = () => (Date.now() - T0) / 1000;

function vllmMetrics(sec, opts = {}) {
  const gen = Math.floor(sec * 180), prompt = Math.floor(sec * 400), done = Math.floor(sec / 3);
  const running = Math.round(2 + 2 * Math.sin(sec / 5)), queued = Math.max(0, Math.round(3 * Math.sin(sec / 17)));
  const cnt = done + 1, ttftSum = cnt * (0.12 + 0.08 * Math.abs(Math.sin(sec / 9))), itlSum = (gen + 1) * 0.011;
  return [
    `vllm:num_requests_running ${running}`, `vllm:num_requests_waiting ${queued}`, `vllm:kv_cache_usage_perc ${0.35 + 0.2 * Math.sin(sec / 11)}`,
    `vllm:generation_tokens_total ${gen}`, `vllm:prompt_tokens_total ${prompt}`, `vllm:e2e_request_latency_seconds_count ${done}`,
    `vllm:time_to_first_token_seconds_sum ${ttftSum}`, `vllm:time_to_first_token_seconds_count ${cnt}`,
    `vllm:inter_token_latency_seconds_sum ${itlSum}`, `vllm:inter_token_latency_seconds_count ${gen + 1}`,
    `vllm:prefix_cache_hits_total ${Math.floor(prompt * 0.4)}`, `vllm:prefix_cache_queries_total ${prompt}`,
    ...(opts.junk ? ['vllm:garbage NaN', 'vllm:inf +Inf', 'not a metric line', 'vllm:broken{ 12'] : [])
  ].join('\n') + '\n';
}

function sglangMetrics(sec) {
  const gen = Math.floor(sec * 120), done = Math.floor(sec / 4);
  return [
    `sglang:num_running_reqs ${Math.round(1 + Math.sin(sec / 6))}`, `sglang:num_queue_reqs 0`, `sglang:token_usage ${0.2 + 0.1 * Math.sin(sec / 8)}`,
    `sglang:gen_throughput ${100 + 30 * Math.sin(sec / 4)}`, `sglang:generation_tokens_total ${gen}`, `sglang:prompt_tokens_total ${Math.floor(sec * 300)}`,
    `sglang:e2e_request_latency_seconds_count ${done}`, `sglang:cache_hit_rate 0.55`,
    `sglang:time_to_first_token_seconds_sum ${(done + 1) * 0.2}`, `sglang:time_to_first_token_seconds_count ${done + 1}`,
    `sglang:inter_token_latency_seconds_sum ${(gen + 1) * 0.014}`, `sglang:inter_token_latency_seconds_count ${gen + 1}`
  ].join('\n') + '\n';
}

const identityV = (name) => JSON.stringify({ data: [{ id: name, root: name, max_model_len: 32768 }] });
const identityS = (name) => JSON.stringify({ served_model_name: name, model_path: name, context_length: 32768, max_running_requests: 16, mem_fraction_static: 0.85 });

const SCENARIOS = [
  { port: 9001, name: 'ok-vllm',      engine: 'vllm',   model: 'Qwen/Qwen3-8B-FP8',        what: 'healthy vLLM' },
  { port: 9002, name: 'ok-sglang',    engine: 'sglang', model: 'meta-llama/Llama-3.1-8B',  what: 'healthy SGLang' },
  { port: 9003, name: 'no-metrics',   engine: 'vllm',   model: 'org/no-metrics-7B',        what: '/metrics returns 404', metrics: () => [404, 'not found'] },
  { port: 9004, name: 'bad-key',      engine: 'vllm',   model: 'org/locked-70B',           what: 'every request returns 401', all: () => [401, 'unauthorized'] },
  { port: 9005, name: 'slow',         engine: 'vllm',   model: 'org/slow-13B',             what: 'responds after 8 s (timeout)', delay: 8000 },
  { port: 9006, name: 'flaky',        engine: 'vllm',   model: 'org/flaky-8B',             what: 'HTTP 500 every other 20 s window', metrics: () => (Math.floor(secs() / 20) % 2 ? [500, 'boom'] : null) },
  { port: 9007, name: 'restarts',     engine: 'vllm',   model: 'org/restarting-8B',        what: 'counters reset to zero every 40 s', clock: () => secs() % 40 },
  { port: 9008, name: 'junk-metrics', engine: 'vllm',   model: 'org/junk-8B',              what: 'NaN / Inf / malformed lines in /metrics', junk: true },
  { port: 9009, name: 'drops',        engine: 'vllm',   model: 'org/drops-8B',             what: 'destroys the socket every 3rd request', drop: true },
  { port: 9010, name: 'goes-away',    engine: 'sglang', model: 'org/mortal-8B',            what: 'answers 90 s, then returns 503 for 60 s', all: () => { const c = secs() % 150; return c > 90 ? [503, 'unavailable'] : null; } }
];

for (const sc of SCENARIOS) {
  let n = 0;
  http.createServer((req, res) => {
    const send = (code, body, type = 'text/plain') => { res.writeHead(code, { 'content-type': type }); res.end(body); };
    const respond = () => {
      n++;
      if (sc.drop && n % 3 === 0) { req.socket.destroy(); return; }
      const all = sc.all && sc.all(); if (all) return send(all[0], all[1]);
      const sec = sc.clock ? sc.clock() : secs();
      if (req.url === '/v1/models' && sc.engine === 'vllm') return send(200, identityV(sc.model), 'application/json');
      if (req.url === '/get_server_info' && sc.engine === 'sglang') return send(200, identityS(sc.model), 'application/json');
      if (req.url === '/metrics') {
        const m = sc.metrics && sc.metrics(); if (m) return send(m[0], m[1]);
        return send(200, sc.engine === 'vllm' ? vllmMetrics(sec, { junk: sc.junk }) : sglangMetrics(sec));
      }
      send(404, 'not found');
    };
    sc.delay ? setTimeout(respond, sc.delay) : respond();
  }).listen(sc.port, '127.0.0.1');
}

console.log('Mock servers running (Ctrl+C to stop):\n');
for (const sc of SCENARIOS) console.log(`  http://127.0.0.1:${sc.port}  [${sc.engine}]  ${sc.name.padEnd(13)} ${sc.what}`);
console.log('  http://127.0.0.1:9099  [vllm]  refused       nothing listens here (connection refused)\n');
console.log('Paste into settings.json:\n');
console.log(JSON.stringify({ 'llmmonitor.extraEndpoints': [...SCENARIOS.map(s => ({ engine: s.engine, url: `http://127.0.0.1:${s.port}`, name: s.name })),
  { engine: 'vllm', url: 'http://127.0.0.1:9099', name: 'refused' }, { engine: 'vllm', url: 'not a url', name: 'bad-url' }] }, null, 2));
