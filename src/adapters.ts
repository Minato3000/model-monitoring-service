import { ModelSnapshot, Target } from './types';
import { avgOf, classifyError, firstSample, httpGet, HttpError, parseProm, Prom, sumOf } from './prom';
import { containerMemory, containerPids, GpuInfo, startupLogs } from './docker';
import { dtypeBytes, DiskInfo, kvPrecision, LogInfo, paramsFromName, parseStartupLogs, readDiskInfo, weightPrecision } from './modelinfo';

const HISTORY = 60;

/** Per-target state kept between polls: static facts read once, and the previous sample for rates. */
interface TargetState {
  model?: string;
  modelRef?: string;
  maxLen?: number;
  maxRunning?: number;
  quant?: string;
  memFraction?: number;
  doneHistory: number[];
  lastOkAt?: number;
  failures: number;
  lastGood?: ModelSnapshot;
  peakTps?: number;
  peakTpsPerReq?: number;
  bestTtftMs?: number;
  bestItlMs?: number;
  dtype?: string;
  kvDtype?: string;
  kvTokens?: number;
  logs?: LogInfo;
  logTries: number;
  disk?: DiskInfo;
  prev?: { t: number; done?: number; gen?: number; prompt?: number; ttft?: [number, number]; itl?: [number, number] };
  tpsHistory: number[];
  queueHistory: number[];
}

const states = new Map<string, TargetState>();

export function pruneStates(live: Set<string>): void {
  for (const k of states.keys()) { if (!live.has(k)) { states.delete(k); } }
}

function stateFor(key: string): TargetState {
  let s = states.get(key);
  if (!s) { s = { logTries: 0, failures: 0, tpsHistory: [], queueHistory: [], doneHistory: [] }; states.set(key, s); }
  return s;
}

function headers(t: Target): Record<string, string> | undefined {
  return t.apiKey ? { Authorization: `Bearer ${t.apiKey}` } : undefined;
}

function push(arr: number[], v: number | undefined): void {
  arr.push(v ?? 0);
  if (arr.length > HISTORY) { arr.shift(); }
}

function delta(cur: number | undefined, prev: number | undefined): number | undefined {
  return cur !== undefined && prev !== undefined && cur >= prev ? cur - prev : undefined;
}

function rate(cur: number | undefined, prev: number | undefined, dt: number): number | undefined {
  if (cur === undefined || prev === undefined || dt <= 0 || cur < prev) { return undefined; }
  return (cur - prev) / dt;
}

/** Mean of a histogram over the interval since the previous poll, in milliseconds. */
function histMeanMs(p: Prom, names: string[], prev: [number, number] | undefined): { ms?: number; now?: [number, number] } {
  for (const n of names) {
    const sum = sumOf(p, n + '_sum');
    const cnt = sumOf(p, n + '_count');
    if (sum === undefined || cnt === undefined) { continue; }
    const now: [number, number] = [sum, cnt];
    if (!prev || cnt <= prev[1]) { return { now }; }
    return { ms: ((sum - prev[0]) / (cnt - prev[1])) * 1000, now };
  }
  return {};
}

async function loadStatic(t: Target, s: TargetState, socket: string): Promise<void> {
  const c = t.container;
  if (c && !s.logs?.weightsBytes && s.logTries < 5) {
    s.logTries++;
    try { s.logs = parseStartupLogs(await startupLogs(socket, c)); } catch { /* logs unavailable */ }
  }
  if (!s.disk && s.modelRef) { s.disk = readDiskInfo(s.modelRef, c?.mounts ?? []); }
}

function fillSizes(snap: ModelSnapshot, s: TargetState, gpuBytes: number | undefined, gpuTotal: number | undefined): void {
  snap.weightsBytes = s.logs?.weightsBytes ?? s.disk?.diskBytes;
  snap.params = s.disk?.params ?? paramsFromName(snap.model);
  snap.dtype = s.dtype ?? s.disk?.dtype;
  snap.kvDtype = s.kvDtype;
  snap.kvTokens = s.logs?.kvTokens ?? s.kvTokens;

  let kv = s.logs?.kvAllocBytes;
  if (kv === undefined && snap.kvTokens && s.disk?.kvBytesPerTokenAt1Byte) {
    const b = dtypeBytes(s.kvDtype && s.kvDtype !== 'auto' ? s.kvDtype : s.dtype ?? s.disk.dtype) ?? 2;
    kv = snap.kvTokens * s.disk.kvBytesPerTokenAt1Byte * b;
  }
  // No startup log (e.g. --log-level warning): SGLang's static pool is weights + KV, sized by mem_fraction_static.
  if (kv === undefined && s.memFraction && gpuTotal && snap.weightsBytes !== undefined) {
    const pool = s.memFraction * gpuTotal - snap.weightsBytes;
    if (pool > 0) { kv = pool; snap.kvEstimated = true; }
  }
  snap.kvAllocBytes = kv;
  if (kv !== undefined && snap.kvUtil !== undefined) { snap.kvUsedBytes = kv * snap.kvUtil / 100; }

  snap.gpuBytes = gpuBytes;
  if (gpuBytes !== undefined && snap.weightsBytes !== undefined && kv !== undefined) {
    snap.otherBytes = Math.max(0, gpuBytes - snap.weightsBytes - kv);
  }
}

export async function pollTarget(
  t: Target, socket: string, gpu: GpuInfo
): Promise<ModelSnapshot> {
  const s = stateFor(t.key);
  const snap: ModelSnapshot = {
    key: t.key, engine: t.engine, model: s.model ?? t.name, source: t.name, endpoint: t.baseUrl,
    status: 'ok', state: 'idle', tpsHistory: s.tpsHistory, queueHistory: s.queueHistory, completedHistory: s.doneHistory
  };
  const h = headers(t);

  try {
    if (!s.model) { await readIdentity(t, s, h); }
    snap.model = s.model ?? t.name;
    snap.maxLen = s.maxLen;
    snap.maxRunning = s.maxRunning ?? t.maxRunning;

    let metricsText: string | undefined;
    try { metricsText = await httpGet(t.baseUrl + '/metrics', { headers: h }); }
    catch (e) {
      const he = classifyError(e, 'metrics endpoint');
      snap.status = 'warn';
      snap.errorKind = he.kind === 'notfound' ? 'nometrics' : he.kind;
      snap.message = he.kind === 'notfound'
        ? (t.engine === 'sglang' ? 'No /metrics endpoint. Start SGLang with --enable-metrics.' : 'No /metrics endpoint. Check that the vLLM server exposes Prometheus metrics.')
        : `Metrics unavailable: ${he.message}`;
    }

    if (metricsText) {
      const p = parseProm(metricsText);
      const now = Date.now();
      const dt = s.prev ? (now - s.prev.t) / 1000 : 0;
      const next: NonNullable<TargetState['prev']> = { t: now };

      if (t.engine === 'vllm') { applyVllm(snap, s, p, dt, next); } else { applySglang(snap, s, p, dt, next); }
      s.prev = next;
      if (snap.running !== undefined && snap.tps !== undefined && snap.running > 0 && snap.tpsPerReq === undefined) {
        snap.tpsPerReq = snap.tps / snap.running;
      }
    }

    await loadStatic(t, s, socket);
    let gpuBytes: number | undefined;
    let gpuTotal: number | undefined;
    if (t.container && gpu.usedByPid.size) {
      try {
        const pids = await containerPids(socket, t.container.id);
        const used = pids.filter(pid => gpu.usedByPid.has(pid));
        if (used.length) {
          gpuBytes = used.reduce((acc, pid) => acc + gpu.usedByPid.get(pid)!, 0);
          const uuids = new Set(used.map(pid => gpu.uuidByPid.get(pid)).filter((u): u is string => !!u));
          const totals = [...uuids].map(u => gpu.totalByUuid.get(u));
          if (totals.length && totals.every(x => x !== undefined)) { gpuTotal = totals.reduce((acc, x) => acc! + x!, 0); }
        }
      } catch { /* docker top failed */ }
    }
    fillSizes(snap, s, gpuBytes, gpuTotal);
    if (snap.tps !== undefined && gpuBytes) { snap.tpsPerGiB = snap.tps / (gpuBytes / 1024 ** 3); }
    const prec = weightPrecision(s.quant ?? t.hints?.quant, s.disk, s.dtype ?? t.hints?.dtype, `${s.modelRef ?? ''} ${snap.model} ${t.name}`);
    snap.wPrec = prec?.label; snap.wBits = prec?.bits;
    const kvp = kvPrecision(s.kvDtype ?? t.hints?.kvDtype, s.dtype ?? t.hints?.dtype ?? s.disk?.dtype);
    snap.kvPrec = kvp?.label; snap.kvBits = kvp?.bits;
    if (t.container) {
      const mem = await containerMemory(socket, t.container.id);
      if (mem) { snap.ramBytes = mem.used; snap.ramLimitBytes = mem.limit; }
    }
    if (snap.tps !== undefined) { s.peakTps = Math.max(s.peakTps ?? 0, snap.tps); }
    if (snap.tpsPerReq !== undefined && (snap.running ?? 0) > 0) { s.peakTpsPerReq = Math.max(s.peakTpsPerReq ?? 0, snap.tpsPerReq); }
    if (snap.ttftMs) { s.bestTtftMs = Math.min(s.bestTtftMs ?? Infinity, snap.ttftMs); }
    if (snap.itlMs) { s.bestItlMs = Math.min(s.bestItlMs ?? Infinity, snap.itlMs); }
    snap.bestTtftMs = s.bestTtftMs; snap.bestItlMs = s.bestItlMs;
    if (t.container && gpu.problem) { snap.gpuNote = gpu.problem; }
    snap.peakTps = s.peakTps; snap.peakTpsPerReq = s.peakTpsPerReq;
    const full = snap.maxRunning !== undefined && (snap.running ?? 0) >= snap.maxRunning;
    snap.state = (snap.queued ?? 0) > 0 || full ? 'saturated' : (snap.running ?? 0) > 0 || (snap.tps ?? 0) > 0 ? 'busy' : 'idle';
    push(s.tpsHistory, snap.tps);
    push(s.queueHistory, snap.queued);
    push(s.doneHistory, snap.completed);
    if (snap.status === 'ok') { s.failures = 0; }
    s.lastOkAt = Date.now();
    snap.lastOkAt = s.lastOkAt;
    s.lastGood = { ...snap };
  } catch (e) {
    const he: HttpError = classifyError(e, 'inference server');
    const recentStart = t.container?.startedAt && Date.now() / 1000 - t.container.startedAt < 900;
    s.failures++;
    // A restart resets the engine's counters and may load another model: re-read both on recovery.
    s.prev = undefined; s.model = undefined;
    // Keep showing the last good numbers (dimmed) instead of blanking the card.
    if (s.lastGood) { Object.assign(snap, s.lastGood); }
    snap.status = 'error';
    snap.state = 'error';
    snap.offline = true;
    snap.failures = s.failures;
    snap.lastOkAt = s.lastOkAt;
    snap.tps = undefined; snap.tpsPerReq = undefined; snap.running = undefined; snap.queued = undefined;
    if ((he.kind === 'refused' || he.kind === 'reset' || he.kind === 'notfound') && recentStart && !s.lastOkAt) {
      snap.errorKind = 'starting';
      snap.message = 'Starting up. The server is not accepting connections yet, usually because it is still loading the model.';
    } else {
      snap.errorKind = he.kind;
      snap.message = he.message;
    }
  }
  return snap;
}

async function readIdentity(t: Target, s: TargetState, h: Record<string, string> | undefined): Promise<void> {
  if (t.engine === 'vllm') {
    const j = JSON.parse(await httpGet(t.baseUrl + '/v1/models', { headers: h }));
    const m = j.data?.[0];
    s.model = m?.id;
    s.modelRef = m?.root ?? m?.id;
    s.maxLen = m?.max_model_len;
  } else {
    const j = JSON.parse(await httpGet(t.baseUrl + '/get_server_info', { headers: h }));
    s.model = j.served_model_name || j.model_path;
    s.modelRef = j.model_path;
    s.maxLen = j.context_length;
    s.maxRunning = j.max_running_requests;
    s.quant = typeof j.quantization === 'string' ? j.quantization : undefined;
    s.memFraction = typeof j.mem_fraction_static === 'number' ? j.mem_fraction_static : undefined;
    s.dtype = j.dtype && j.dtype !== 'auto' ? j.dtype : undefined;
    s.kvDtype = j.kv_cache_dtype;
    s.kvTokens = j.max_total_num_tokens;
  }
}

function applyVllm(snap: ModelSnapshot, s: TargetState, p: Prom, dt: number, next: NonNullable<TargetState['prev']>): void {
  snap.running = sumOf(p, 'vllm:num_requests_running');
  snap.queued = sumOf(p, 'vllm:num_requests_waiting');
  const util = avgOf(p, 'vllm:kv_cache_usage_perc', 'vllm:gpu_cache_usage_perc');
  if (util !== undefined) { snap.kvUtil = util * 100; }
  snap.cacheHit = hitRate(p, 'vllm:prefix_cache_hits_total', 'vllm:prefix_cache_queries_total');

  const cfg = firstSample(p, 'vllm:cache_config_info');
  if (cfg) {
    const blocks = Number(cfg.labels.num_gpu_blocks);
    const size = Number(cfg.labels.block_size);
    if (blocks > 0 && size > 0) { s.kvTokens = blocks * size; }
    s.kvDtype = cfg.labels.cache_dtype;
  }

  next.done = sumOf(p, 'vllm:e2e_request_latency_seconds_count', 'vllm:request_success_total');
  snap.completed = delta(next.done, s.prev?.done);
  next.gen = sumOf(p, 'vllm:generation_tokens_total');
  next.prompt = sumOf(p, 'vllm:prompt_tokens_total');
  snap.tps = rate(next.gen, s.prev?.gen, dt);
  snap.promptTps = rate(next.prompt, s.prev?.prompt, dt);

  const ttft = histMeanMs(p, ['vllm:time_to_first_token_seconds'], s.prev?.ttft);
  const itl = histMeanMs(p, ['vllm:inter_token_latency_seconds', 'vllm:time_per_output_token_seconds'], s.prev?.itl);
  next.ttft = ttft.now; next.itl = itl.now;
  snap.ttftMs = ttft.ms; snap.itlMs = itl.ms;
  if (itl.ms) { snap.tpsPerReq = 1000 / itl.ms; }
}

function applySglang(snap: ModelSnapshot, s: TargetState, p: Prom, dt: number, next: NonNullable<TargetState['prev']>): void {
  snap.running = sumOf(p, 'sglang:num_running_reqs');
  snap.queued = sumOf(p, 'sglang:num_queue_reqs');
  const usage = avgOf(p, 'sglang:token_usage');
  if (usage !== undefined) { snap.kvUtil = usage * 100; }
  const hit = avgOf(p, 'sglang:cache_hit_rate');
  if (hit !== undefined) { snap.cacheHit = hit * 100; }

  next.done = sumOf(p, 'sglang:e2e_request_latency_seconds_count');
  snap.completed = delta(next.done, s.prev?.done);
  next.gen = sumOf(p, 'sglang:generation_tokens_total');
  next.prompt = sumOf(p, 'sglang:prompt_tokens_total');
  snap.tps = sumOf(p, 'sglang:gen_throughput') ?? rate(next.gen, s.prev?.gen, dt);
  snap.promptTps = rate(next.prompt, s.prev?.prompt, dt);

  const ttft = histMeanMs(p, ['sglang:time_to_first_token_seconds'], s.prev?.ttft);
  const itl = histMeanMs(p, ['sglang:inter_token_latency_seconds', 'sglang:time_per_output_token_seconds'], s.prev?.itl);
  next.ttft = ttft.now; next.itl = itl.now;
  snap.ttftMs = ttft.ms; snap.itlMs = itl.ms;
  if (itl.ms) { snap.tpsPerReq = 1000 / itl.ms; }
}

function hitRate(p: Prom, hits: string, queries: string): number | undefined {
  const h = sumOf(p, hits);
  const q = sumOf(p, queries);
  return h !== undefined && q ? (h / q) * 100 : undefined;
}
