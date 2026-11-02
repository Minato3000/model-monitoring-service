#!/usr/bin/env node
/* Builds out/preview.html: the real panel UI in a plain browser, with VS Code's theme variables faked
 * for dark, light and high-contrast, and buttons that feed it every state (healthy, offline, starting,
 * no metrics, auth failure, Docker down, empty, stale).   npm run compile && node scripts/preview.js  */
const fs = require('fs');
const path = require('path');
const { getWebviewContent } = require('../out/webview');

const THEMES = {
  'vscode-dark': { '--vscode-foreground': '#cccccc', '--vscode-descriptionForeground': '#9d9d9d', '--vscode-sideBar-background': '#181818', '--vscode-charts-blue': '#3794ff', '--vscode-charts-red': '#f14c4c', '--vscode-charts-yellow': '#cca700', '--vscode-charts-purple': '#b180d7', '--vscode-charts-green': '#89d185', '--vscode-button-background': '#0e639c', '--vscode-button-foreground': '#ffffff' },
  'vscode-light': { '--vscode-foreground': '#3b3b3b', '--vscode-descriptionForeground': '#717171', '--vscode-sideBar-background': '#f8f8f8', '--vscode-charts-blue': '#1a85ff', '--vscode-charts-red': '#e51400', '--vscode-charts-yellow': '#bf8803', '--vscode-charts-purple': '#652d90', '--vscode-charts-green': '#388a34', '--vscode-button-background': '#007acc', '--vscode-button-foreground': '#ffffff' },
  'vscode-high-contrast': { '--vscode-foreground': '#ffffff', '--vscode-descriptionForeground': '#ffffff', '--vscode-sideBar-background': '#000000', '--vscode-charts-blue': '#75beff', '--vscode-charts-red': '#f48771', '--vscode-charts-yellow': '#ffd700', '--vscode-charts-purple': '#d7a6ff', '--vscode-charts-green': '#89d185', '--vscode-contrastBorder': '#6fc3df', '--vscode-focusBorder': '#f38518', '--vscode-button-background': '#000000', '--vscode-button-foreground': '#ffffff' },
  'vscode-high-contrast-light': { '--vscode-foreground': '#292929', '--vscode-descriptionForeground': '#292929', '--vscode-sideBar-background': '#ffffff', '--vscode-charts-blue': '#0f4a85', '--vscode-charts-red': '#b5200d', '--vscode-charts-yellow': '#895503', '--vscode-charts-purple': '#652d90', '--vscode-charts-green': '#007100', '--vscode-contrastBorder': '#0f4a85', '--vscode-focusBorder': '#006bbd', '--vscode-button-background': '#ffffff', '--vscode-button-foreground': '#292929' }
};
const themeCss = Object.entries(THEMES).map(([k, v]) => `.${k}{${Object.entries(v).map(([a, b]) => `${a}:${b}`).join(';')}}`).join('\n');

const stub = `
<style>${themeCss}
  #pv{position:sticky;top:0;z-index:9;display:flex;flex-wrap:wrap;gap:4px;padding:6px;background:#8884;backdrop-filter:blur(6px);font:11px sans-serif}
  #pv button{font:inherit;cursor:pointer;padding:2px 8px}
  html{background:#8883;--vscode-font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;--vscode-editor-font-family:'JetBrains Mono','DejaVu Sans Mono',Consolas,monospace}
  html.clean #pv{display:none} body{max-width:340px;margin:0 auto;min-height:100vh}
  body.wide{max-width:760px} body.narrow{max-width:210px}
</style>
<script>
  window.acquireVsCodeApi = () => ({ postMessage: m => console.log('to extension:', m), getState: () => (location.hash.includes('closed') ? {} : { open: '["ok"]' }), setState() {} });
  document.documentElement.dataset.preview = '1';
</script>`;

const controls = `
<script>
  const hist = (base, amp) => Array.from({ length: 60 }, (_, i) => Math.max(0, base + amp * Math.sin(i / 6) + (i % 7) * amp * 0.1));
  const done = Array.from({ length: 60 }, (_, i) => (i % 11 === 0 ? 1 : 0));
  const good = (o = {}) => Object.assign({ key: 'ok', engine: 'vllm', model: 'Qwen/Qwen3-8B-FP8', source: 'qwen3', endpoint: 'http://127.0.0.1:8000', status: 'ok', state: 'busy',
    tps: 184, peakTps: 240, tpsHistory: hist(150, 40), queueHistory: [], completedHistory: done, running: 4, queued: 0, maxRunning: 16, kvUtil: 42, kvAllocBytes: 30e9, kvUsedBytes: 12e9,
    weightsBytes: 9e9, otherBytes: 3e9, gpuBytes: 42e9, ramBytes: 6e9, ramLimitBytes: 64e9, ttftMs: 140, itlMs: 11, bestTtftMs: 90, bestItlMs: 9, cacheHit: 40, promptTps: 400, tpsPerReq: 46, peakTpsPerReq: 70,
    wPrec: 'FP8', wBits: 8, params: 8e9, maxLen: 32768 }, o);
  const off = (kind, message, o = {}) => good(Object.assign({ key: 'bad-' + kind, model: 'org/' + kind + '-8B', source: kind, status: 'error', state: 'error', offline: true, errorKind: kind, message,
    lastOkAt: Date.now() - 42000, failures: 3, tps: undefined, running: undefined, queued: undefined }, o));
  const SC = {
    'Healthy': () => ({ models: [good(), good({ key: 'sg', engine: 'sglang', model: 'meta-llama/Llama-3.1-8B', source: 'llama', state: 'idle', tps: 0, tpsHistory: hist(5, 2) })] }),
    'Saturated': () => ({ models: [good({ state: 'saturated', running: 16, queued: 7, kvUtil: 96 })] }),
    'Offline': () => ({ models: [off('refused', 'The server is not accepting connections. It may be starting up, loading the model, or have crashed.')] }),
    'Starting': () => ({ models: [off('starting', 'Starting up. The server is not accepting connections yet, usually because it is still loading the model.', { lastOkAt: undefined, failures: 1, tpsHistory: [], completedHistory: [] })] }),
    'Timeout': () => ({ models: [off('timeout', 'The server did not respond in time. It may be busy or overloaded.')] }),
    'Auth failed': () => ({ models: [off('auth', 'The server rejected the API key (HTTP 401). Set the correct key on the container or endpoint.', { lastOkAt: undefined })] }),
    'No metrics': () => ({ models: [good({ status: 'warn', errorKind: 'nometrics', message: 'No /metrics endpoint. Start SGLang with --enable-metrics.', state: 'idle', tps: undefined, tpsHistory: [], kvUtil: undefined })] }),
    'No GPU data': () => ({ models: [good({ gpuNote: 'nvidia-smi not found (nvidia-smi). Set llmmonitor.nvidiaSmiPath.', gpuBytes: undefined, otherBytes: undefined })] }),
    'Docker down': () => ({ models: [], notice: { level: 'warn', text: 'Docker is not reachable at /var/run/docker.sock. Permission denied. Add your user to the docker group or fix the socket permissions. Showing extra endpoints only.', action: 'openSettings' } }),
    'Empty': () => ({ models: [] }),
    'Mixed': () => ({ models: [good(), off('refused', 'The server is not accepting connections.'), off('auth', 'The server rejected the API key (HTTP 401).', { lastOkAt: undefined })], notice: { level: 'warn', text: 'An entry in llmmonitor.extraEndpoints is invalid. It was skipped.', action: 'openSettings' } }),
    'Ext. error': () => ({ type: 'error', message: 'The monitor hit an unexpected error: boom' })
  };
  const send = name => { const d = SC[name](); window.postMessage(Object.assign({ type: 'models', interval: 2000, at: Date.now() }, d), '*'); };
  const setCls = (theme, w) => { document.body.className = theme + ' ' + (w || ''); document.documentElement.className = theme; };
  const pv = document.getElementById('pv');
  const add = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; pv.appendChild(b); };
  ${JSON.stringify(Object.keys(THEMES))}.forEach(t => add(t.replace('vscode-', ''), () => { setCls(t, document.body.dataset.w || ''); window.postMessage({ type: 'theme', kind: t }, '*'); }));
  [['narrow', 'narrow'], ['normal', ''], ['wide', 'wide']].forEach(([l, c]) => add('w:' + l, () => { document.body.dataset.w = c; setCls(document.body.className.split(' ').find(x => x.startsWith('vscode-')), c); }));
  Object.keys(SC).forEach(n => add(n, () => send(n)));
  add('stale', () => { window.postMessage({ type: 'models', models: SC['Healthy']().models, interval: 2000, at: Date.now() - 60000 }, '*'); });
  setCls('vscode-dark', '');
  send('Healthy');
  // #theme,State,width  e.g. #light,Offline,wide  (used for screenshots)
  const [ht, hs, hw, hf] = decodeURIComponent(location.hash.slice(1)).split(',');
  if (hf && hf.includes('clean')) document.documentElement.classList.add('clean');
  if (ht) { document.body.dataset.w = hw === 'wide' || hw === 'narrow' ? hw : ''; setCls('vscode-' + ht, document.body.dataset.w); if (hf && hf.includes('clean')) document.documentElement.classList.add('clean'); }
  if (hs && SC[hs]) send(hs);
</script>`;

let html = getWebviewContent();
html = html.replace('</head>', stub + '</head>').replace('<body>', '<body>\n<div id="pv"></div>').replace('</body>', controls + '</body>');
const out = path.join(__dirname, '..', 'out', 'preview.html');
fs.writeFileSync(out, html);
console.log('Wrote ' + out + '\nOpen it in a browser, then use the buttons to switch theme, width and state.');
