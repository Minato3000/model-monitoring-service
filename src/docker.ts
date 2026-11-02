import { execFile } from 'child_process';
import { ContainerInfo, Engine, Target } from './types';
import { classifyError, httpGet, httpGetBuffer } from './prom';

const DEFAULT_PORT: Record<Engine, number> = { vllm: 8000, sglang: 30000 };
const inspectCache = new Map<string, Target | null>();

async function api(socket: string, path: string): Promise<string> {
  try { return await httpGet(`http://docker${path}`, { socketPath: socket, timeout: 4000 }); }
  catch (e) { throw classifyError(e, 'Docker daemon'); }
}

/** The command line decides; the image name is only used when the command says nothing (e.g. a bare `--model` list). */
function classify(label: string | undefined, image: string, args: string[]): Engine | null {
  if (label === 'vllm' || label === 'sglang') { return label; }
  const h = (args.length ? args.join(' ') : image).toLowerCase();
  if (h.includes('sglang')) { return 'sglang'; }
  if (h.includes('vllm')) { return 'vllm'; }
  return null;
}

/** Compose commands are often one shell string, so values can carry quotes or escaped quotes. */
const unquote = (v: string | undefined) => v?.replace(/^[\\"']+|[\\"']+$/g, '');

function argValue(args: string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) { return unquote(args[i + 1]); }
    if (args[i].startsWith(flag + '=')) { return unquote(args[i].slice(flag.length + 1)); }
  }
  return undefined;
}

async function inspectTarget(socket: string, id: string): Promise<Target | null> {
  const info = JSON.parse(await api(socket, `/containers/${id}/json`));
  const cfg = info.Config ?? {};
  const args: string[] = [...(cfg.Entrypoint ?? []), ...(cfg.Cmd ?? []), ...(info.Args ?? [])]
    .flatMap((a: string) => String(a).split(/\s+/));
  const image: string = cfg.Image ?? '';
  const engine = classify(cfg.Labels?.['llm.monitor'], image, args);
  if (!engine) { return null; }

  const port = Number(argValue(args, '--port')) || DEFAULT_PORT[engine];
  const env: string[] = cfg.Env ?? [];
  const envVal = (k: string) => env.find(e => e.startsWith(k + '='))?.slice(k.length + 1);
  const apiKey = argValue(args, '--api-key') ?? envVal('VLLM_API_KEY') ?? envVal('SGLANG_API_KEY') ?? envVal('API_KEY');

  let host = '127.0.0.1';
  let hostPort = port;
  const net = info.NetworkSettings ?? {};
  if (info.HostConfig?.NetworkMode !== 'host') {
    const bound = net.Ports?.[`${port}/tcp`]?.[0];
    if (bound?.HostPort) {
      hostPort = Number(bound.HostPort);
    } else {
      const ip = Object.values<any>(net.Networks ?? {}).map(n => n.IPAddress).find(Boolean);
      if (!ip) { return null; }
      host = ip;
    }
  }

  const container: ContainerInfo = {
    id,
    name: String(info.Name ?? id).replace(/^\//, ''),
    image,
    startedAt: Math.floor(Date.parse(info.State?.StartedAt ?? '') / 1000) || 0,
    mounts: (info.Mounts ?? []).map((m: any) => ({ source: m.Source, destination: m.Destination }))
  };
  const maxRunning = Number(argValue(args, '--max-running-requests') ?? argValue(args, '--max-num-seqs')) || undefined;
  const hints = { quant: argValue(args, '--quantization'), dtype: argValue(args, '--dtype'), kvDtype: argValue(args, '--kv-cache-dtype') };
  return { key: id, engine, name: container.name, baseUrl: `http://${host}:${hostPort}`, apiKey, maxRunning, hints, container };
}

export async function discoverContainers(socket: string): Promise<Target[]> {
  const list: { Id: string }[] = JSON.parse(await api(socket, '/containers/json'));
  const alive = new Set(list.map(c => c.Id));
  for (const id of inspectCache.keys()) { if (!alive.has(id)) { inspectCache.delete(id); } }

  const out: Target[] = [];
  for (const c of list) {
    if (!inspectCache.has(c.Id)) {
      try { inspectCache.set(c.Id, await inspectTarget(socket, c.Id)); } catch { continue; }
    }
    const t = inspectCache.get(c.Id);
    if (t) { out.push(t); }
  }
  return out;
}

/** Docker's log stream is multiplexed (8-byte frame headers) unless the container has a TTY. */
function demux(buf: Buffer): string {
  if (buf.length < 8 || buf[0] > 2 || buf[1] !== 0 || buf[2] !== 0 || buf[3] !== 0) { return buf.toString('utf8'); }
  const parts: string[] = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i + 4);
    parts.push(buf.subarray(i + 8, i + 8 + len).toString('utf8'));
    i += 8 + len;
  }
  return parts.join('');
}

/** Startup output only: the 15 minutes after the latest start (the full log is mostly request noise). */
export async function startupLogs(socket: string, c: ContainerInfo): Promise<string> {
  const range = c.startedAt ? `&since=${c.startedAt}&until=${c.startedAt + 900}` : '&tail=3000';
  const buf = await httpGetBuffer(`http://docker/containers/${c.id}/logs?stdout=1&stderr=1${range}`,
    { socketPath: socket, timeout: 8000 });
  return demux(buf);
}

export async function containerPids(socket: string, id: string): Promise<number[]> {
  const top = JSON.parse(await api(socket, `/containers/${id}/top?ps_args=-eo%20pid`));
  return (top.Processes ?? []).map((p: string[]) => Number(p[0])).filter((n: number) => n > 0);
}

export interface GpuInfo {
  usedByPid: Map<number, number>;
  uuidByPid: Map<number, string>;
  totalByUuid: Map<string, number>;
  /** Why GPU numbers are missing, when they are. */
  problem?: string;
}

export const emptyGpu = (): GpuInfo => ({ usedByPid: new Map(), uuidByPid: new Map(), totalByUuid: new Map() });

function smi(smiPath: string, args: string[], fail: { msg?: string }): Promise<string> {
  return new Promise(resolve => {
    execFile(smiPath, [...args, '--format=csv,noheader,nounits'], { timeout: 4000 }, (err, stdout) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException).code;
        fail.msg = code === 'ENOENT' ? `nvidia-smi not found (${smiPath}). Set llmmonitor.nvidiaSmiPath.`
          : (err as any).killed ? 'nvidia-smi timed out.' : 'nvidia-smi failed. Is the NVIDIA driver loaded?';
        resolve('');
      } else { resolve(stdout); }
    });
  });
}

/** Per-process GPU memory, plus each GPU's total memory (needed to size SGLang's static pool). */
export async function gpuInfo(smiPath: string): Promise<GpuInfo> {
  const fail: { msg?: string } = {};
  const [apps, gpus] = await Promise.all([
    smi(smiPath, ['--query-compute-apps=pid,used_memory,gpu_uuid'], fail),
    smi(smiPath, ['--query-gpu=uuid,memory.total'], fail)
  ]);
  const out = emptyGpu();
  out.problem = fail.msg;
  const MIB = 1024 * 1024;
  for (const line of apps.split('\n')) {
    const [pid, mib, uuid] = line.split(',').map(x => x.trim());
    if (Number(pid) > 0 && Number(mib) >= 0) {
      out.usedByPid.set(Number(pid), (out.usedByPid.get(Number(pid)) ?? 0) + Number(mib) * MIB);
      out.uuidByPid.set(Number(pid), uuid);
    }
  }
  for (const line of gpus.split('\n')) {
    const [uuid, mib] = line.split(',').map(x => x.trim());
    if (uuid && Number(mib) > 0) { out.totalByUuid.set(uuid, Number(mib) * MIB); }
  }
  return out;
}

/** Host RAM used by the container, without reclaimable page cache. */
export async function containerMemory(socket: string, id: string): Promise<{ used: number; limit: number } | undefined> {
  try {
    const j = JSON.parse(await httpGet(`http://docker/containers/${id}/stats?stream=false&one-shot=true`, { socketPath: socket, timeout: 4000 }));
    const mem = j.memory_stats;
    if (!mem?.usage) { return undefined; }
    const cache = mem.stats?.inactive_file ?? mem.stats?.total_inactive_file ?? mem.stats?.cache ?? 0;
    return { used: Math.max(0, mem.usage - cache), limit: mem.limit };
  } catch { return undefined; }
}
