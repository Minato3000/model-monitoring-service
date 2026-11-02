import * as http from 'http';
import * as https from 'https';

export interface Sample { labels: Record<string, string>; value: number }
export type Prom = Map<string, Sample[]>;

export function parseProm(text: string): Prom {
  const out: Prom = new Map();
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#') { continue; }
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)/.exec(line);
    if (!m) { continue; }
    const value = Number(m[3]);
    if (!Number.isFinite(value)) { continue; }
    const labels: Record<string, string> = {};
    if (m[2]) {
      for (const l of m[2].matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) { labels[l[1]] = l[2]; }
    }
    const arr = out.get(m[1]);
    if (arr) { arr.push({ labels, value }); } else { out.set(m[1], [{ labels, value }]); }
  }
  return out;
}

/** Sum of the first metric name that exists (metric names differ between engine versions). */
export function sumOf(p: Prom, ...names: string[]): number | undefined {
  for (const n of names) {
    const s = p.get(n);
    if (s && s.length) { return s.reduce((a, x) => a + x.value, 0); }
  }
  return undefined;
}

export function avgOf(p: Prom, ...names: string[]): number | undefined {
  for (const n of names) {
    const s = p.get(n);
    if (s && s.length) { return s.reduce((a, x) => a + x.value, 0) / s.length; }
  }
  return undefined;
}

export function firstSample(p: Prom, name: string): Sample | undefined {
  return p.get(name)?.[0];
}

export type ErrorKind = 'refused' | 'timeout' | 'auth' | 'notfound' | 'server' | 'dns' | 'reset' | 'permission' | 'nosocket' | 'other';

export class HttpError extends Error {
  constructor(public kind: ErrorKind, message: string, public status?: number) { super(message); }
}

/** Turns a raw Node/HTTP failure into a kind plus a sentence a person can act on. */
export function classifyError(e: unknown, what = 'server'): HttpError {
  if (e instanceof HttpError) { return e; }
  const err = e as NodeJS.ErrnoException;
  switch (err?.code) {
    case 'ECONNREFUSED': return new HttpError('refused', `The ${what} is not accepting connections. It may be starting up, loading the model, or have crashed.`);
    case 'ECONNRESET': case 'EPIPE': return new HttpError('reset', `The connection to the ${what} was reset. It may be restarting.`);
    case 'ENOTFOUND': case 'EAI_AGAIN': return new HttpError('dns', `Host name could not be resolved. Check the endpoint URL.`);
    case 'EHOSTUNREACH': case 'ENETUNREACH': return new HttpError('refused', `The ${what} host is unreachable from this machine.`);
    case 'EACCES': case 'EPERM': return new HttpError('permission', `Permission denied. Add your user to the docker group or fix the socket permissions.`);
    case 'ENOENT': return new HttpError('nosocket', `Socket not found. Is Docker running, and is the socket path in settings correct?`);
    case 'ETIMEDOUT': return new HttpError('timeout', `The ${what} did not respond in time. It may be busy or overloaded.`);
  }
  if (err?.message === 'timeout') { return new HttpError('timeout', `The ${what} did not respond in time. It may be busy or overloaded.`); }
  if (err instanceof TypeError && /Invalid URL/i.test(err.message)) { return new HttpError('other', `Invalid endpoint URL.`); }
  return new HttpError('other', err?.message || String(e));
}

export interface HttpOpts {
  headers?: Record<string, string>;
  timeout?: number;
  socketPath?: string;
}

export function httpGetBuffer(url: string, opts: HttpOpts = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try { u = new URL(url); } catch (e) { reject(classifyError(e)); return; }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: opts.socketPath ? undefined : u.hostname,
      port: opts.socketPath ? undefined : u.port || undefined,
      socketPath: opts.socketPath,
      path: u.pathname + u.search,
      method: 'GET',
      headers: opts.headers,
      timeout: opts.timeout ?? 3000
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const code = res.statusCode ?? 0;
        if (code === 401 || code === 403) { reject(new HttpError('auth', 'The server rejected the API key (HTTP ' + code + '). Set the correct key on the container or endpoint.', code)); }
        else if (code === 404) { reject(new HttpError('notfound', `HTTP 404 ${u.pathname}`, code)); }
        else if (code >= 500) { reject(new HttpError('server', `The server returned HTTP ${code} on ${u.pathname}.`, code)); }
        else if (code >= 400) { reject(new HttpError('other', `HTTP ${code} ${u.pathname}`, code)); }
        else { resolve(body); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', e => reject(classifyError(e)));
    req.end();
  });
}

export async function httpGet(url: string, opts: HttpOpts = {}): Promise<string> {
  return (await httpGetBuffer(url, opts)).toString('utf8');
}
