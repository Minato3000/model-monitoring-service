import * as fs from 'fs';
import * as path from 'path';
import { Mount } from './types';

const GIB = 1024 ** 3;
const DTYPE_BYTES: Record<string, number> = {
  float32: 4, float: 4, float16: 2, half: 2, bfloat16: 2, bf16: 2, fp8: 1, float8: 1, int8: 1
};

export interface LogInfo { weightsBytes?: number; kvAllocBytes?: number; kvTokens?: number }
export interface DiskInfo {
  diskBytes?: number;
  params?: number;
  dtype?: string;
  quantized?: boolean;
  quantMethod?: string;
  quantBits?: number;
  quantFloat?: boolean;
  /** KV bytes per token at 1 byte/element; undefined for architectures we cannot size (MLA, sliding-window, hybrid). */
  kvBytesPerTokenAt1Byte?: number;
}

/** Pulls the weight and KV-cache sizes that each engine prints once at startup (latest startup only). */
export function parseStartupLogs(text: string): LogInfo {
  const out: LogInfo = {};
  const num = (s: string) => Number(s.replace(/,/g, ''));

  // The log can span restarts; start from the last weight-loading line.
  const marks = [...text.matchAll(/Model loading took|Load weight end/gi)];
  const run = marks.length ? text.slice(marks[marks.length - 1].index) : text;
  let m: RegExpExecArray | null;

  if ((m = /Model loading took ([\d.]+)\s*GiB/i.exec(run))) { out.weightsBytes = num(m[1]) * GIB; }
  else if ((m = /Load weight end.*?mem usage=([\d.]+)\s*GB/i.exec(run))) { out.weightsBytes = num(m[1]) * GIB; }

  if ((m = /Available KV cache memory:\s*([\d.]+)\s*GiB/i.exec(run))) { out.kvAllocBytes = num(m[1]) * GIB; }

  // SGLang: one line per cache pool (full attention, SWA, ...); sizes add up.
  let sglangBytes = 0;
  for (const k of run.matchAll(/KV Cache is allocated\.(?:\s*dtype:\s*\S+,)?\s*#tokens:\s*(\d+),\s*K size:\s*([\d.]+)\s*GB,\s*V size:\s*([\d.]+)\s*GB/gi)) {
    sglangBytes += (num(k[2]) + num(k[3])) * GIB;
    out.kvTokens = Math.max(out.kvTokens ?? 0, num(k[1]));
  }
  if (sglangBytes) { out.kvAllocBytes = sglangBytes; }

  if ((m = /GPU KV cache size:\s*([\d,]+)\s*tokens/i.exec(run))) { out.kvTokens = num(m[1]); }
  return out;
}

function hostPath(ref: string, mounts: Mount[]): string | undefined {
  if (path.isAbsolute(ref)) {
    const mount = mounts.filter(m => ref === m.destination || ref.startsWith(m.destination + '/'))
      .sort((a, b) => b.destination.length - a.destination.length)[0];
    if (mount) { return path.join(mount.source, ref.slice(mount.destination.length)); }
    return fs.existsSync(ref) ? ref : undefined;
  }
  // HuggingFace id: look for a cache layout inside any mount.
  const dirName = 'models--' + ref.replace(/\//g, '--');
  for (const m of mounts) {
    for (const base of [path.join(m.source, 'hub'), m.source]) {
      const snaps = path.join(base, dirName, 'snapshots');
      try {
        const latest = fs.readdirSync(snaps).map(n => path.join(snaps, n))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
        if (latest) { return latest; }
      } catch { /* not in this mount */ }
    }
  }
  return undefined;
}

/** Reads config.json and the weight files of the model directory, when it is reachable from the host. */
export function readDiskInfo(ref: string | undefined, mounts: Mount[]): DiskInfo {
  if (!ref) { return {}; }
  const dir = hostPath(ref, mounts);
  if (!dir) { return {}; }
  const out: DiskInfo = {};
  try {
    const files = fs.readdirSync(dir);
    const weightFiles = files.filter(f => f.endsWith('.safetensors'));
    const use = weightFiles.length ? weightFiles : files.filter(f => /\.(bin|pt|gguf)$/.test(f));
    out.diskBytes = use.reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0) || undefined;

    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
    const t = cfg.text_config ?? cfg;
    const dtype = String(cfg.torch_dtype ?? t.torch_dtype ?? '').replace('torch.', '');
    out.dtype = dtype || undefined;
    const qc = cfg.quantization_config ?? t.quantization_config;
    out.quantized = Boolean(qc);
    if (qc) {
      const group = qc.config_groups ? Object.values<any>(qc.config_groups)[0]?.weights : undefined;
      out.quantMethod = qc.quant_method;
      out.quantBits = qc.bits ?? group?.num_bits ?? (/fp8/i.test(qc.quant_method ?? '') ? 8 : undefined);
      out.quantFloat = group?.type === 'float' || /fp8/i.test(qc.quant_method ?? '');
    }
    const bpp = DTYPE_BYTES[dtype];
    if (out.diskBytes && bpp && !out.quantized) { out.params = out.diskBytes / bpp; }

    const layers = t.num_hidden_layers;
    const heads = t.num_attention_heads;
    const kvHeads = t.num_key_value_heads ?? heads;
    const headDim = t.head_dim ?? (t.hidden_size && heads ? t.hidden_size / heads : undefined);
    if (layers && kvHeads && headDim && !t.kv_lora_rank && !t.sliding_window && !t.layer_types) { out.kvBytesPerTokenAt1Byte = 2 * layers * kvHeads * headDim; }
  } catch { /* partial info is fine */ }
  return out;
}

/** "Qwen3-8B" -> 8e9; used only when the weights are not readable from disk. */
export function paramsFromName(name: string): number | undefined {
  const m = /(?:^|[^a-z0-9.])(\d+(?:\.\d+)?)\s*([bm])(?![a-z])/i.exec(name);
  if (!m) { return undefined; }
  return Number(m[1]) * (m[2].toLowerCase() === 'b' ? 1e9 : 1e6);
}

export function dtypeBytes(dtype: string | undefined): number | undefined {
  if (!dtype) { return undefined; }
  const d = dtype.toLowerCase().replace('torch.', '');
  if (d.includes('fp8') || d.includes('float8')) { return 1; }
  return DTYPE_BYTES[d];
}

export interface Precision { label: string; bits?: number }

const LABEL: Record<string, string> = {
  bfloat16: 'BF16', bf16: 'BF16', float16: 'FP16', half: 'FP16', fp16: 'FP16', float32: 'FP32', fp32: 'FP32', float: 'FP32',
  fp8: 'FP8', float8: 'FP8', int8: 'INT8', int4: 'INT4', fp4: 'FP4', mxfp4: 'MXFP4', nvfp4: 'NVFP4', awq: 'AWQ', gptq: 'GPTQ'
};
const BITS: Record<string, number> = {
  BF16: 16, FP16: 16, FP32: 32, FP8: 8, INT8: 8, INT4: 4, FP4: 4, MXFP4: 4, NVFP4: 4, AWQ: 4, GPTQ: 4
};

function named(raw: string): Precision {
  const q = raw.toLowerCase().replace('torch.', '').replace(/_e\dm\d.*$/, '');
  const label = LABEL[q] ?? raw.toUpperCase();
  return { label, bits: BITS[label] };
}

/** Weight precision: checkpoint quantization first, then --quantization, then the compute dtype. */
export function weightPrecision(quant: string | undefined, disk: DiskInfo | undefined, dtype: string | undefined, nameHint: string): Precision | undefined {
  if (disk?.quantBits) {
    const m = (disk.quantMethod ?? '').toLowerCase();
    const label = disk.quantFloat ? `FP${disk.quantBits}` : (m === 'awq' || m === 'gptq') ? m.toUpperCase() : `INT${disk.quantBits}`;
    return { label, bits: disk.quantBits };
  }
  if (quant && !/^(none|null|auto)$/i.test(quant)) { return named(quant); }
  const d = dtype && dtype !== 'auto' ? dtype : disk?.dtype;
  if (/fp8/i.test(nameHint)) { return { label: 'FP8', bits: 8 }; }
  return d ? named(d) : undefined;
}

export function kvPrecision(kvDtype: string | undefined, weightDtype: string | undefined): Precision | undefined {
  const d = kvDtype && kvDtype !== 'auto' ? kvDtype : weightDtype && weightDtype !== 'auto' ? weightDtype : undefined;
  return d ? named(d) : undefined;
}
