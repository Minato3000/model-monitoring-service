export type Engine = 'vllm' | 'sglang';

export interface Notice { level: 'info' | 'warn' | 'error'; text: string; action?: 'openSettings' | 'retry' }

/** One physical GPU, for the group headers in the panel. */
export interface GpuSummary { index: number; name?: string; totalBytes?: number; usedBytes?: number }

export interface Mount { source: string; destination: string }

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  /** Epoch seconds of the latest container start; the startup log lives right after it. */
  startedAt: number;
  mounts: Mount[];
}

export interface Target {
  key: string;
  engine: Engine;
  name: string;
  baseUrl: string;
  apiKey?: string;
  /** From --max-running-requests (SGLang) or --max-num-seqs (vLLM). */
  maxRunning?: number;
  /** Precision flags from the launch command (--quantization, --dtype, --kv-cache-dtype). */
  hints?: { quant?: string; dtype?: string; kvDtype?: string };
  container?: ContainerInfo;
  /** GPUs the container was started with (docker --gpus / NVIDIA_VISIBLE_DEVICES): indices, or 'all'. Fallback when nvidia-smi can't map processes. */
  gpuHint?: string[];
}

/** One card in the panel. Optional numbers are undefined when the source does not report them. */
export interface ModelSnapshot {
  key: string;
  engine: Engine;
  model: string;
  source: string;
  endpoint: string;
  status: 'ok' | 'warn' | 'error';
  state: 'idle' | 'busy' | 'saturated' | 'error';
  message?: string;
  /** Why the card is in a warning/error state, so the panel can pick a label and visual. */
  errorKind?: string;
  /** True when the values shown are the last good ones, not live data. */
  offline?: boolean;
  /** Epoch ms of the last successful poll. */
  lastOkAt?: number;
  failures?: number;
  /** Set when GPU memory could not be read (nvidia-smi missing or failing). */
  gpuNote?: string;
  /** Indices of the GPUs this server runs on, sorted. Empty or missing when unknown. */
  gpuIds?: number[];
  maxLen?: number;
  maxRunning?: number;
  dtype?: string;
  kvDtype?: string;
  /** Weight precision, e.g. FP8 / 8 bits. */
  wPrec?: string;
  wBits?: number;
  kvPrec?: string;
  kvBits?: number;
  /** Container host-RAM use (page cache excluded) and its limit. */
  ramBytes?: number;
  ramLimitBytes?: number;
  /** Highest values seen since the panel loaded. */
  peakTps?: number;
  peakTpsPerReq?: number;
  params?: number;
  weightsBytes?: number;
  kvAllocBytes?: number;
  kvUsedBytes?: number;
  kvUtil?: number;
  kvTokens?: number;
  gpuBytes?: number;
  otherBytes?: number;
  running?: number;
  queued?: number;
  tps?: number;
  promptTps?: number;
  tpsPerReq?: number;
  /** Generation tokens/s per GiB of the container's GPU memory. */
  tpsPerGiB?: number;
  ttftMs?: number;
  bestTtftMs?: number;
  bestItlMs?: number;
  itlMs?: number;
  cacheHit?: number;
  /** True when kvAllocBytes is derived from the static memory fraction, not read from the server. */
  kvEstimated?: boolean;
  /** Requests that finished during the latest poll interval. */
  completed?: number;
  tpsHistory: number[];
  queueHistory: number[];
  completedHistory: number[];
}
