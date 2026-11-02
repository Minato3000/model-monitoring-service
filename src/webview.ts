export function getWebviewContent(): string {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LLM Server Monitor</title>
  <style>
    :root {
      --text:    var(--vscode-foreground);
      --dim:     var(--vscode-descriptionForeground);
      --accent:  var(--vscode-charts-blue, #3794ff);
      --good:    var(--vscode-charts-green, #3fb68b);
      --crit:    var(--vscode-charts-red, #f2555a);
      --warn:    var(--vscode-charts-yellow, #d9a53f);
      --weights: color-mix(in srgb, var(--vscode-foreground) 48%, transparent);
      --runtime: var(--vscode-charts-purple, #b180d7);
      --tile:    color-mix(in srgb, var(--vscode-foreground) 5%, transparent);
      --track:   color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
      /* spacing scale: every gap and padding comes from here */
      --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px;
      --indent: 0px;
      --hover:   color-mix(in srgb, var(--accent) 7%, transparent);
      --r-card: 12px; --r-tile: 10px;
      --ease:    cubic-bezier(0.22, 1, 0.36, 1);
      --ui:      var(--vscode-font-family), system-ui, sans-serif;
      --mono:    var(--vscode-editor-font-family), ui-monospace, monospace;
    }
    :root { color-scheme: light dark; }
    body.vscode-light, body.vscode-high-contrast-light { color-scheme: light; }
    body.vscode-dark, body.vscode-high-contrast { color-scheme: dark; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { overflow-y: auto; scrollbar-gutter: stable; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background, rgba(121,121,121,0.4)); border-radius: 3px; }
    body { background: var(--vscode-sideBar-background); color: var(--text); font-family: var(--ui);
           font-size: 12px; line-height: 1.45; padding: var(--s2) var(--s3) var(--s5); overflow-x: hidden; }
    .num { font-family: var(--mono); font-variant-numeric: tabular-nums; }
    .dim { color: var(--dim); }

    #empty { color: var(--dim); text-align: center; padding: 28px 10px; line-height: 1.6; }
    #empty .ico { font-size: 22px; opacity: .6; margin-bottom: var(--s2); }
    #empty h3 { color: var(--text); font-size: 12.5px; font-weight: 600; margin-bottom: var(--s2); }
    #empty ul { text-align: left; margin: var(--s3) auto 0; padding-left: 18px; max-width: 260px; font-size: 11px; }
    #empty code, .banner code { font-family: var(--mono); font-size: 10.5px; background: var(--tile); padding: 0 4px; border-radius: 4px; }
    .banner { display: flex; gap: var(--s3); align-items: flex-start; font-size: 11px; line-height: 1.5; padding: var(--s3); margin-bottom: var(--s2);
              border-radius: var(--r-tile); overflow-wrap: anywhere; color: var(--text);
              background: color-mix(in srgb, var(--warn) 12%, transparent); border-left: 3px solid var(--warn); }
    .banner.err { background: color-mix(in srgb, var(--crit) 12%, transparent); border-left-color: var(--crit); }
    .banner.info { background: var(--tile); border-left-color: var(--accent); }
    .banner { flex-wrap: wrap; }
    .banner .bt { flex: 1 1 150px; min-width: 0; }
    .banner button, #empty button { font: inherit; font-size: 11px; cursor: pointer; color: var(--vscode-button-foreground, var(--text)); background: var(--vscode-button-background, var(--tile));
              border: 1px solid var(--vscode-contrastBorder, transparent); border-radius: 4px; padding: 2px var(--s3); white-space: nowrap; }
    .banner button:hover, #empty button:hover { background: var(--vscode-button-hoverBackground, var(--hover)); }
    #empty button { margin-top: var(--s3); }
    button:focus-visible, .top:focus-visible { outline: 1px solid var(--vscode-focusBorder, var(--accent)); outline-offset: 1px; }
    .head-line { display: flex; justify-content: space-between; color: var(--dim); font-size: 10.5px;
                 letter-spacing: 0.1em; text-transform: uppercase; padding: var(--s3) var(--s2) var(--s2); }

    .head-line[hidden], #empty[hidden] { display: none; }

    /* ---------- model card ---------- */
    .card { container-type: inline-size; border-radius: var(--r-card); margin-bottom: var(--s2); transition: background-color .35s var(--ease); }
    .card.open { background: color-mix(in srgb, var(--vscode-foreground) 3.5%, transparent); }
    .card:hover, .card.open:hover { background: var(--hover); }
    .top { padding: var(--s4) var(--s3); border-radius: var(--r-card); cursor: pointer; outline-offset: -1px; }

    .l1 { display: flex; align-items: center; gap: var(--s3); min-width: 0; }
    .name { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; letter-spacing: -0.005em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: opacity .4s var(--ease); }
    .tps { font-size: 17px; font-weight: 600; letter-spacing: -0.02em; transition: opacity .4s var(--ease); }
    .tps small { font-family: var(--ui); font-size: 10px; font-weight: 400; color: var(--dim); margin-left: 4px; letter-spacing: 0; }
    .idle .name, .idle .tps { opacity: .5; }
    /* one colour hook per card: charts and the end dot follow it, so state colours are CSS-only and theme-safe */
    .card { --c: var(--accent); }
    .saturated { --c: var(--crit); }
    .offline, .stale { --c: var(--dim); }
    .offline .name, .offline .tps, .offline .l2, .offline .bento, .stale .l2, .stale .tps { opacity: .45; }
    .offline .tps { color: var(--dim); }
    .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--dim); display: none; }
    .offline .dot { display: block; background: var(--crit); } .offline.starting .dot { background: var(--warn); }
    .stale .dot { display: block; background: var(--warn); }
    .chip.st { color: var(--crit); background: color-mix(in srgb, var(--crit) 14%, transparent); }
    .chip.st.warn { color: var(--warn); background: color-mix(in srgb, var(--warn) 16%, transparent); }
    .alert { margin: var(--s3) 0 0 var(--indent); font-size: 11px; line-height: 1.5; color: var(--text); border-left: 2px solid var(--crit); padding-left: var(--s3); overflow-wrap: anywhere; }
    .alert.warn { border-left-color: var(--warn); }
    .alert small { display: block; color: var(--dim); font-size: 10.5px; margin-top: 2px; }
    .alert[hidden], .gpunote[hidden] { display: none; }
    .gpunote { font-size: 10.5px; color: var(--warn); margin-top: var(--s2); }
    body.vscode-high-contrast .tile, body.vscode-high-contrast-light .tile, body.vscode-high-contrast .card, body.vscode-high-contrast-light .card,
    body.vscode-high-contrast .banner, body.vscode-high-contrast-light .banner { outline: 1px solid var(--vscode-contrastBorder, var(--text)); outline-offset: -1px; }
    body.vscode-high-contrast .mem, body.vscode-high-contrast-light .mem { outline: 1px solid var(--vscode-contrastBorder, var(--text)); }
    body.vscode-high-contrast .chart .ln, body.vscode-high-contrast-light .chart .ln { stroke-width: 2.2; }
    body.vscode-high-contrast .dim, body.vscode-high-contrast-light .dim, body.vscode-high-contrast .sub, body.vscode-high-contrast-light .sub { color: var(--text); }
    .saturated .tps { color: var(--crit); }
    .busy .tps { color: var(--accent); }

    .chips { display: flex; flex-wrap: wrap; gap: var(--s2); margin: var(--s3) 0 0 var(--indent); }
    .chip { font-size: 10.5px; color: var(--dim); background: var(--tile); border-radius: 999px; padding: 2px var(--s3); white-space: nowrap; }
    .chip.prec { color: var(--text); }
    .chip[hidden] { display: none; }

    .peek { display: grid; grid-template-rows: 1fr; transition: grid-template-rows .55s var(--ease), opacity .35s var(--ease); }
    .open .peek { grid-template-rows: 0fr; opacity: 0; }
    .peek-in { overflow: hidden; min-height: 0; }
    .l2 { margin: var(--s4) 0 0; }
    .mstats { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s3); margin-top: var(--s3); }
    .ml { color: var(--dim); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; }
    .mv { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; margin-top: 2px; }
    .mv small { font-family: var(--ui); font-size: 10.5px; font-weight: 400; color: var(--dim); margin-left: 2px; letter-spacing: 0; }
    .mv.warm { color: var(--warn); } .mv.hot, .mv.crit { color: var(--crit); }

    /* ---------- memory bar ---------- */
    .mem { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: var(--track); }
    .mem.big { height: 10px; border-radius: 5px; }
    .mem i { display: block; height: 100%; width: 0; border-right: 2px solid transparent; transition: width .9s var(--ease); }
    .mem i:last-child { border-right: 0; }
    .mem .w { background: var(--weights); background-clip: padding-box; opacity: .75; }
    .mem .u { background: var(--accent); background-clip: padding-box; }
    .mem .f { background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--accent) 55%, transparent) 0 2px, color-mix(in srgb, var(--accent) 12%, transparent) 2px 5px); background-clip: padding-box; }
    .mem .o { background: var(--runtime); background-clip: padding-box; opacity: .85; }

    /* ---------- chart ---------- */
    .chart { position: relative; }
    .chart svg { display: block; width: 100%; overflow: visible; }
    .chart .ln { fill: none; stroke: var(--c); stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
    .chart .gl { stroke: var(--text); stroke-opacity: .09; stroke-width: 1; stroke-dasharray: 2 4; vector-effect: non-scaling-stroke; }
    .chart .end { position: absolute; right: 0; width: 7px; height: 7px; margin: -3.5px -3.5px 0 0; border-radius: 50%; background: var(--c);
                  box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 25%, transparent); top: 100%; }
    .gs0 { stop-color: var(--c); stop-opacity: .30; } .gs1 { stop-color: var(--c); stop-opacity: 0; }
    .chart.mini svg { height: 30px; } .chart.mini .end { width: 6px; height: 6px; margin: -3px -3px 0 0; box-shadow: none; }
    .chart.big svg { height: 72px; }
    .marks { position: absolute; inset: 0; pointer-events: none; }
    .marks i { position: absolute; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%; box-sizing: border-box;
               border: 1.5px solid var(--text); background: var(--vscode-sideBar-background); pointer-events: auto; }
    .legend-done { display: inline-flex; align-items: center; gap: var(--s2); }
    .legend-done i { width: 8px; height: 8px; border-radius: 50%; box-sizing: border-box; border: 1.5px solid var(--text); }
    .row-split { display: flex; justify-content: space-between; align-items: center; gap: var(--s3); }
    .cmax { position: absolute; right: 0; top: -14px; font-size: 9.5px; line-height: 1; color: var(--dim); }
    .chart .pk { stroke: var(--text); stroke-opacity: .35; stroke-width: 1; stroke-dasharray: 1.5 3; stroke-linecap: round; vector-effect: non-scaling-stroke; }

    /* ---------- expandable bento ---------- */
    .fold { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows .55s var(--ease), opacity .35s var(--ease); }
    .open .fold { grid-template-rows: 1fr; opacity: 1; }
    .fold-in { overflow: hidden; min-height: 0; }
    .bento { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s2); padding: 0 var(--s2) var(--s2); }
    .tile { background: var(--tile); border-radius: var(--r-tile); padding: var(--s3) var(--s4) var(--s4); min-width: 0; display: flex; flex-direction: column; gap: var(--s1); }
    .tile.wide { grid-column: span 2; }
    .lab { display: flex; justify-content: space-between; align-items: baseline; color: var(--dim); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; }
    .lab .r { letter-spacing: 0; text-transform: none; font-size: 10.5px; }
    .big-num { font-size: 26px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; margin-top: var(--s1); }
    .big-num small, .mid-num small { font-family: var(--ui); font-size: 11px; font-weight: 400; color: var(--dim); letter-spacing: 0; margin-left: 4px; }
    .mid-num { font-size: 19px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.15; margin-top: var(--s1); }
    .sub { font-size: 11px; color: var(--dim); }
    .sub b { color: var(--text); font-weight: 500; }
    .crit { color: var(--crit); }
    .tile .chart { margin-top: var(--s3); }
    .tile .chart.big { margin-top: calc(var(--s3) + 10px); }

    .bar { height: 4px; border-radius: 2px; background: var(--track); overflow: hidden; margin-top: var(--s3); }
    .bar i { display: block; height: 100%; width: 0; background: var(--accent); border-radius: 2px; transition: width .9s var(--ease), background-color .5s var(--ease); }

    .ringrow { display: flex; align-items: center; gap: var(--s3); margin-top: var(--s2); }
    .ring { width: 46px; height: 46px; flex: none; transform: rotate(-90deg); }
    .ring circle { fill: none; stroke-width: 3.6; }
    .ring .rt { stroke: var(--track); }
    .ring .rf { stroke: var(--accent); stroke-dasharray: 0 100; stroke-linecap: round; transition: stroke-dasharray .9s var(--ease), stroke .5s var(--ease); }
    .ring .rf.hot { stroke: var(--crit); } .ring .rf.warm { stroke: var(--warn); }

    .legend { display: grid; grid-template-columns: repeat(4, auto); justify-content: space-between; gap: var(--s2); margin-top: var(--s3); }
    .lg { display: flex; flex-direction: column; gap: var(--s1); min-width: 0; }
    .lg .k { display: flex; align-items: center; gap: var(--s2); color: var(--dim); font-size: 10px; white-space: nowrap; }
    .sw { width: 7px; height: 7px; border-radius: 2px; flex: none; }
    .lg .v { font-size: 11.5px; padding-left: var(--s4); white-space: nowrap; }

    .trio { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s3); margin-top: var(--s2); }
    .trio .mid-num { font-size: 16px; margin-top: 2px; }
    .lines { display: flex; flex-direction: column; gap: var(--s2); margin-top: var(--s2); font-size: 11.5px; }
    .lines div { display: flex; justify-content: space-between; gap: 8px; }
    .lines span:first-child { color: var(--dim); }

    .foot { padding: var(--s1) var(--s3) var(--s4) calc(var(--s3) + var(--indent)); font-size: 10.5px; color: var(--dim); display: flex; flex-direction: column; gap: var(--s1); overflow-wrap: anywhere; }
    .foot .msg { color: var(--warn); } .foot .msg.err { color: var(--crit); }

    /* ---------- responsive: the layout reflows with the panel width (container queries on each card) ---------- */
    @container (max-width: 250px) {
      .bento { grid-template-columns: 1fr; }
      .tile.wide { grid-column: auto; }
      .tile { padding: var(--s3); }
      .legend { grid-template-columns: repeat(2, auto); row-gap: var(--s3); }
      .trio { grid-template-columns: 1fr; }
      .big-num { font-size: 22px; }
      .mstats { grid-template-columns: repeat(2, 1fr); }
    }
    @container (min-width: 520px) {
      .bento { grid-template-columns: repeat(4, 1fr); }
      .tile.wide { grid-column: span 4; }
      .tile.wide:nth-last-child(-n+2) { grid-column: span 2; }   /* Latency + GPU memory share the last row */
    }
    @media (prefers-reduced-motion: reduce) {
      .fold, .peek, .mem i, .bar i, .ring .rf, .card { transition: none; }
    }
  </style>
</head>
<body>
  <div id="banner"></div>
  <div id="stale"></div>
  <div id="empty">
    <div class="ico">&#9881;</div>
    <h3 id="emptyTitle">Looking for vLLM and SGLang servers...</h3>
    <div id="emptyBody">Scanning running Docker containers.</div>
    <ul id="emptyHints" hidden>
      <li>Start a vLLM or SGLang container, or label one with <code>llm.monitor=vllm</code>.</li>
      <li>Or add a server under <code>llmmonitor.extraEndpoints</code>.</li>
      <li>SGLang needs <code>--enable-metrics</code>.</li>
    </ul>
    <button id="emptyBtn" hidden>Open settings</button>
  </div>
  <div id="head" class="head-line" hidden><span>Models</span><span class="num" id="count"></span></div>
  <div id="cards"></div>
<script>
  const vscode = acquireVsCodeApi();
  const $ = id => document.getElementById(id);
  const open = new Set(JSON.parse((vscode.getState() || {}).open || '[]').slice(0, 1));
  const cards = new Map();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const GIB = 1073741824;
  const dash = '\\u2014';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- formatting ---------- */
  const WORDS = { embeddinggemma: 'EmbeddingGemma', glm: 'GLM', gpt: 'GPT', oss: 'OSS', deepseek: 'DeepSeek', ocr: 'OCR', vl: 'VL',
    it: 'IT', moe: 'MoE', awq: 'AWQ', gptq: 'GPTQ', fp8: 'FP8', fp16: 'FP16', bf16: 'BF16', gguf: 'GGUF', llm: 'LLM', vlm: 'VLM',
    qwq: 'QwQ', smollm: 'SmolLM', codellama: 'CodeLlama', phi: 'Phi', nemotron: 'Nemotron' };
  function pretty(raw) {
    const base = String(raw).split('/').pop().replace(/\\.(gguf|safetensors)$/i, '');
    return base.split(/[-_\\s]+/).filter(Boolean).map(p => {
      const l = p.toLowerCase();
      if (WORDS[l]) return WORDS[l];
      if (/^[ae]?\\d+(\\.\\d+)?[bkmt]$/i.test(p)) return p.toUpperCase();
      if (/^\\d/.test(p)) return p;
      return p.charAt(0).toUpperCase() + p.slice(1);
    }).join(' ');
  }
  function hostPort(ep) {
    try {
      const u = new URL(ep);
      const local = /^(127\\.|localhost$|10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.)/.test(u.hostname);
      return local ? ':' + u.port : u.hostname + ':' + u.port;
    } catch (e) { return ep; }
  }
  function count(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K';
    return String(Math.round(n));
  }
  const rate = v => v >= 100 ? v.toFixed(0) : v.toFixed(1);
  const gibStr = b => { const g = b / GIB; return g >= 100 ? g.toFixed(0) : g.toFixed(1); };
  const ms = n => n === undefined ? dash : n >= 1000 ? (n / 1000).toFixed(2) + ' s' : n.toFixed(0) + ' ms';
  const kvPct = v => Math.round(v) + '%';

  /* ---------- animation helpers ---------- */
  const ease = k => 1 - Math.pow(1 - k, 3);   // ease-out, same feel as the CSS bezier
  function tween(dur, onFrame, onDone) {
    if (reduce || dur <= 0) { onFrame(1); if (onDone) onDone(); return 0; }
    let t0 = null;
    const step = now => {
      if (t0 === null) t0 = now;
      const k = Math.max(0, Math.min(1, (now - t0) / dur));
      onFrame(ease(k));
      if (k < 1) el_raf = requestAnimationFrame(step); else if (onDone) onDone();
    };
    let el_raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(el_raf);
  }
  function setNum(el, v, fmt) {
    if (el._cancel) { el._cancel(); el._cancel = null; }
    if (v === undefined || v === null || Number.isNaN(v)) { el.textContent = dash; el._v = undefined; return; }
    const from = el._v === undefined ? v : el._v;
    el._v = v;
    if (from === v) { el.textContent = fmt(v); return; }
    el._cancel = tween(750, e => { el.textContent = fmt(from + (v - from) * e); });
  }
  const setText = (el, t) => { if (el.textContent !== t) el.textContent = t; };

  /* Monotone cubic bezier through the points: smooth, and never overshoots below zero. */
  function smoothPath(p) {
    const n = p.length;
    if (n < 2) return '';
    const dx = [], s = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) { dx[i] = p[i + 1][0] - p[i][0]; s[i] = (p[i + 1][1] - p[i][1]) / dx[i]; }
    m[0] = s[0]; m[n - 1] = s[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = s[i - 1] * s[i] <= 0 ? 0 : (s[i - 1] + s[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (s[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / s[i], b = m[i + 1] / s[i], h = a * a + b * b;
      if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * s[i]; m[i + 1] = t * b * s[i]; }
    }
    let d = 'M' + p[0][0].toFixed(2) + ' ' + p[0][1].toFixed(2);
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += ' C' + (p[i][0] + h).toFixed(2) + ' ' + (p[i][1] + m[i] * h).toFixed(2) + ' ' +
           (p[i + 1][0] - h).toFixed(2) + ' ' + (p[i + 1][1] - m[i + 1] * h).toFixed(2) + ' ' +
           p[i + 1][0].toFixed(2) + ' ' + p[i + 1][1].toFixed(2);
    }
    return d;
  }

  let gradId = 0;
  function Chart(host, H, grid) {
    this.H = H; this.cur = []; this.vals = []; this.cancel = null; this.mpos = [];
    const id = 'g' + (gradId++);
    let svg = '<svg viewBox="0 0 100 ' + H + '" preserveAspectRatio="none"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" class="gs0"/><stop offset="1" class="gs1"/></linearGradient></defs>';
    if (grid) [0.25, 0.5, 0.75].forEach(f => { svg += '<line class="gl" x1="0" x2="100" y1="' + (H * f) + '" y2="' + (H * f) + '"/>'; });
    if (grid) svg += '<line class="pk" x1="0" x2="100" y1="3" y2="3"/>';
    svg += '<path class="ar" fill="url(#' + id + ')"/><path class="ln"/></svg><i class="end"></i>' + (grid ? '<span class="cmax num"></span><div class="marks"></div>' : '');
    host.innerHTML = svg;
    this.ar = host.querySelector('.ar'); this.ln = host.querySelector('.ln');
    this.end = host.querySelector('.end'); this.cmax = host.querySelector('.cmax'); this.marksEl = host.querySelector('.marks');
  }
  /* Fixed-width time axis: sample k always sits at a constant x step from the right edge, so a new
     sample only scrolls the line left. The y scale is tweened too, so a changing max never reshapes the curve. */
  const CAP = 60;
  Chart.prototype.yOf = function (v, max) { return 3 + (1 - v / max) * (this.H - 6); };
  Chart.prototype.render = function (e) {
    const vals = this.vals, n = vals.length, H = this.H, step = 100 / (CAP - 1);
    const max = this.max0 + (this.max1 - this.max0) * e;
    const off = this.mode === 'shift' ? (1 - e) * step : 0;
    const xs = [], ys = [];
    for (let k = 0; k < n; k++) {
      let v = vals[k], x = 100 - (n - 1 - k) * step;
      if (k < n - 1) x += off;
      else if (this.mode === 'shift') v = this.prevLast + (v - this.prevLast) * e;
      else v = v * e;   // first draw: grow up from the baseline
      xs.push(x); ys.push(this.yOf(v, max));
    }
    const line = smoothPath(xs.map((x, i) => [x, ys[i]]));
    this.ln.setAttribute('d', line);
    this.ar.setAttribute('d', line + ' L100 ' + H + ' L' + xs[0].toFixed(2) + ' ' + H + ' Z');
    this.end.style.top = (ys[n - 1] / H * 100) + '%';
    if (this.cmax) this.cmax.textContent = max >= 1 ? rate(max) : '';
    this.drawMarks(xs, ys);
  };
  Chart.prototype.drawMarks = function (xs, ys) {
    const host = this.marksEl;
    if (!host) return;
    const list = this.mpos, H = this.H;
    while (host.children.length < list.length) host.appendChild(document.createElement('i'));
    while (host.children.length > list.length) host.lastChild.remove();
    list.forEach((mk, k) => {
      const el = host.children[k];
      el.style.left = xs[mk.i] + '%';
      el.style.top = (ys[mk.i] / H * 100) + '%';
      el.title = mk.count + (mk.count === 1 ? ' request completed' : ' requests completed');
    });
  };
  Chart.prototype.set = function (vals, marks) {
    const n = vals.length;
    if (n < 2) return;
    const prev = this.vals;
    const same = prev.length === n && prev.every((v, i) => Math.abs(v - vals[i]) < 1e-9);
    const sameMarks = !marks || (this.mk && this.mk.length === marks.length && this.mk.every((v, i) => v === marks[i]));
    if (same && sameMarks) return;   // nothing new: leave the chart (and any running animation) alone
    this.mk = marks ? marks.slice() : null;
    this.mpos = [];
    if (marks && this.marksEl) marks.forEach((count, j) => { if (count > 0 && j < n) this.mpos.push({ i: j, count: count }); });
    const newMax = Math.max.apply(null, vals.concat([1]));
    if (same) { this.vals = vals.slice(); this.max0 = this.max1 = newMax; this.mode = 'none'; this.render(1); return; }
    // Where the curve currently is (mid-animation), so a new sample never snaps the line back.
    const curMax = this.max0 === undefined ? newMax : this.max0 + (this.max1 - this.max0) * (this.e === undefined ? 1 : this.e);
    this.mode = prev.length ? 'shift' : 'first';
    this.prevLast = prev.length ? prev[prev.length - 1] : 0;
    this.max0 = prev.length ? curMax : newMax; this.max1 = newMax;
    this.vals = vals.slice();
    if (this.cancel) this.cancel();
    this.cancel = tween(900, e => { this.e = e; this.render(e); });
  };

  /* ---------- DOM ---------- */
  const SEGS = '<i class="w"></i><i class="u"></i><i class="f"></i><i class="o"></i>';
  const ring = r => '<svg class="ring" viewBox="0 0 36 36"><circle class="rt" cx="18" cy="18" r="15.9"/><circle class="rf" data-r="' + r + '" cx="18" cy="18" r="15.9" pathLength="100"/></svg>';
  const tile = (cls, label, right, body) => '<div class="tile ' + cls + '"><div class="lab"><span>' + label + '</span><span class="r num dim" ' + (right ? 'data-r="' + right + '"' : '') + '></span></div>' + body + '</div>';

  function build(m) {
    const el = document.createElement('section');
    el.className = 'card';
    el.dataset.key = m.key;
    el.innerHTML =
      '<div class="top" tabindex="0" role="button">' +
        '<div class="l1"><i class="dot" data-r="dot"></i><span class="name" data-r="name"></span>' +
        '<span class="tps num"><span data-r="tpsTop"></span><small>tok/s</small></span></div>' +
        '<div class="chips"><span class="chip" data-r="cParams" hidden></span><span class="chip prec" data-r="cPrec" hidden></span><span class="chip" data-r="cCtx" hidden></span><span class="chip num" data-r="cPort"></span><span class="chip st" data-r="cStatus" hidden></span></div>' +
        '<div class="alert" data-r="alert" hidden></div>' +
        '<div class="peek"><div class="peek-in"><div class="l2"><div class="chart mini" data-r="miniChart"></div>' +
          '<div class="mstats">' +
            '<div><div class="ml">KV cache</div><div class="mv num" data-r="mKv"></div></div>' +
            '<div><div class="ml">Running</div><div class="mv num"><span data-r="mRun"></span><small data-r="mMax"></small></div></div>' +
            '<div><div class="ml">Queued</div><div class="mv num" data-r="mQ"></div></div>' +
          '</div></div></div></div>' +
      '</div>' +
      '<div class="fold"><div class="fold-in"><div class="bento">' +
        tile('wide', 'Throughput', '',
          '<div class="big-num num"><span data-r="tpsBig"></span><small>tok/s</small></div><div class="chart big" data-r="bigChart"></div>' +
          '<div class="sub row-split" style="margin-top:var(--s2)"><span>prefill <b class="num" data-r="prefill"></b></span><span class="legend-done"><i></i>request completed</span></div>') +
        tile('', 'Per request', '',
          '<div class="mid-num num"><span data-r="each"></span><small>tok/s</small></div><div class="bar"><i data-r="eachBar"></i></div>' +
          '<div class="sub" style="margin-top:var(--s2)">peak <b class="num" data-r="peakEach"></b></div>') +
        tile('', 'Slots', '',
          '<div class="ringrow">' + ring('slotRing') + '<div><div class="mid-num num"><span data-r="running"></span><small data-r="slotMax"></small></div>' +
          '<div class="sub">queue <b class="num" data-r="queued"></b></div></div></div>') +
        tile('', 'KV cache', '',
          '<div class="ringrow">' + ring('kvRing') + '<div class="mid-num num"><span data-r="kvPct"></span></div></div>' +
          '<div class="sub num" style="margin-top:var(--s2)" data-r="kvUsed"></div>') +
        tile('', 'Host RAM', '',
          '<div class="mid-num num"><span data-r="ram"></span><small>GiB</small></div><div class="bar"><i data-r="ramBar"></i></div>' +
          '<div class="sub" style="margin-top:var(--s2)" data-r="ramSub"></div>') +
        tile('wide', 'Latency', '',
          '<div class="trio"><div><div class="sub">TTFT</div><div class="mid-num num" data-r="ttft"></div><div class="sub">best <b class="num" data-r="bestTtft"></b></div></div>' +
          '<div><div class="sub">Inter-token</div><div class="mid-num num" data-r="itl"></div><div class="sub">best <b class="num" data-r="bestItl"></b></div></div>' +
          '<div><div class="sub">Prefix hit</div><div class="mid-num num" data-r="hit"></div></div></div>') +
        tile('wide', 'GPU memory', 'gpuTotal',
          '<div class="mem big" data-mem style="margin-top:var(--s3)">' + SEGS + '</div>' +
          '<div class="legend">' +
            '<div class="lg"><span class="k"><i class="sw" style="background:var(--weights)"></i>Weights</span><span class="v num" data-r="lw"></span></div>' +
            '<div class="lg"><span class="k"><i class="sw" style="background:var(--accent)"></i>KV used</span><span class="v num" data-r="lu"></span></div>' +
            '<div class="lg"><span class="k"><i class="sw" style="background:repeating-linear-gradient(135deg,var(--accent) 0 1.5px,transparent 1.5px 3px)"></i>KV free</span><span class="v num" data-r="lf"></span></div>' +
            '<div class="lg" data-r="runtimeTip"><span class="k"><i class="sw" style="background:var(--runtime)"></i><span data-r="lrLabel">Runtime</span></span><span class="v num" data-r="lr"></span></div>' +
          '</div><div class="gpunote" data-r="gpuNote" hidden></div>') +
      '</div><div class="foot" data-r="foot"></div></div></div>';

    const c = { el, r: {}, mems: [...el.querySelectorAll('[data-mem]')] };
    el.querySelectorAll('[data-r]').forEach(n => { c.r[n.dataset.r] = n; });
    c.mini = new Chart(c.r.miniChart, 30, false);
    c.big = new Chart(c.r.bigChart, 72, true);
    if (open.has(m.key)) el.classList.add('open');
    return c;
  }

  /** Splits the container's GPU memory into weights / KV used / KV free / runtime. */
  function segments(m) {
    const w = m.weightsBytes || 0, kv = m.kvAllocBytes;
    const used = kv !== undefined ? (m.kvUsedBytes || 0) : 0;
    const free = kv !== undefined ? Math.max(0, kv - used) : 0;
    let other = m.otherBytes;
    if (other === undefined && m.gpuBytes !== undefined && kv === undefined) other = Math.max(0, m.gpuBytes - w);
    other = other || 0;
    return { w, used, free, other, kv, total: Math.max(m.gpuBytes || 0, w + used + free + other) };
  }

  function update(c, m) {
    const r = c.r, s = segments(m);
    c.el.classList.remove('idle', 'busy', 'saturated', 'error', 'offline', 'starting');
    c.el.classList.add(m.state);
    c.el.classList.toggle('offline', !!m.offline);
    c.el.classList.toggle('starting', m.errorKind === 'starting');
    c.m = m;
    renderAlert(c, m);
    r.gpuNote.hidden = !m.gpuNote; setText(r.gpuNote, m.gpuNote ? 'GPU memory unavailable: ' + m.gpuNote : '');

    setText(r.name, pretty(m.model)); r.name.title = m.model;
    setNum(r.tpsTop, m.tps, rate);
    setNum(r.tpsBig, m.tps, rate);

    const precText = m.wPrec ? m.wPrec + (m.wBits ? ' \\u00b7 ' + m.wBits + '-bit' : '') : '';
    r.cPrec.hidden = !precText; setText(r.cPrec, precText);
    r.cParams.hidden = !m.params; if (m.params) setText(r.cParams, count(m.params));
    r.cPrec.title = 'Weights ' + (m.wPrec || dash) + (m.kvPrec ? ' \\u00b7 KV cache ' + m.kvPrec : '');
    r.cCtx.hidden = !m.maxLen; if (m.maxLen) setText(r.cCtx, count(m.maxLen) + ' ctx');
    setText(r.cPort, hostPort(m.endpoint)); r.cPort.title = m.endpoint;

    c.mini.set(m.tpsHistory); c.big.set(m.tpsHistory, m.completedHistory);
    r.mKv.className = 'mv num' + (m.kvUtil >= 90 ? ' hot' : m.kvUtil >= 70 ? ' warm' : '');
    setNum(r.mKv, m.kvUtil, kvPct);
    setNum(r.mRun, m.running, v => String(Math.round(v)));
    setText(r.mMax, m.maxRunning ? '/' + m.maxRunning : '');
    r.mQ.className = 'mv num' + (m.queued > 0 ? ' crit' : '');
    setNum(r.mQ, m.queued, v => String(Math.round(v)));
    setNum(r.prefill, m.promptTps, v => rate(v) + ' tok/s');

    setNum(r.each, m.tpsPerReq, rate);
    setText(r.peakEach, m.peakTpsPerReq === undefined ? dash : rate(m.peakTpsPerReq) + ' tok/s');
    const eachPct = m.tpsPerReq && m.peakTpsPerReq ? Math.min(100, m.tpsPerReq / m.peakTpsPerReq * 100) : 0;
    r.eachBar.style.width = eachPct + '%';

    setNum(r.running, m.running, v => String(Math.round(v)));
    setText(r.slotMax, m.maxRunning ? '/' + m.maxRunning : '');
    r.queued.className = 'num' + (m.queued > 0 ? ' crit' : '');
    setNum(r.queued, m.queued, v => String(Math.round(v)));
    const slotPct = m.maxRunning && m.running !== undefined ? Math.min(100, m.running / m.maxRunning * 100) : 0;
    r.slotRing.style.strokeDasharray = slotPct + ' 100';
    r.slotRing.setAttribute('class', 'rf' + (slotPct >= 100 ? ' hot' : slotPct >= 75 ? ' warm' : ''));

    const kv = m.kvUtil;
    setNum(r.kvPct, kv, kvPct);
    r.kvRing.style.strokeDasharray = (kv || 0) + ' 100';
    r.kvRing.setAttribute('class', 'rf' + (kv >= 90 ? ' hot' : kv >= 70 ? ' warm' : ''));
    let kvText = '';
    if (s.kv !== undefined) kvText = (m.kvEstimated ? '~' : '') + gibStr(s.used) + ' / ' + gibStr(s.kv) + ' GiB';
    else if (m.kvTokens && m.kvUtil !== undefined) kvText = count(m.kvTokens * m.kvUtil / 100) + ' / ' + count(m.kvTokens) + ' tokens';
    setText(r.kvUsed, kvText);
    r.kvUsed.title = m.kvEstimated ? 'Estimated: the static memory pool (memory fraction x GPU memory) minus the weights.' : '';

    const pct = v => s.total ? (v / s.total * 100) + '%' : '0%';
    c.mems.forEach(bar => {
      const [w, u, f, o] = bar.children;
      w.style.width = pct(s.w); u.style.width = pct(s.used); f.style.width = pct(s.free); o.style.width = pct(s.other);
    });
    setNum(r.gpuTotal, s.total || undefined, v => gibStr(v) + ' GiB');
    setText(r.lw, m.weightsBytes === undefined ? dash : gibStr(m.weightsBytes));
    setText(r.lu, s.kv === undefined ? dash : gibStr(s.used));
    setText(r.lf, s.kv === undefined ? dash : gibStr(s.free));
    const noKv = s.kv === undefined;
    setText(r.lrLabel, noKv ? 'KV + runtime' : 'Runtime');
    r.runtimeTip.title = noKv
      ? 'Everything on the GPU besides the weights. This server does not report its KV cache size, so KV and runtime are shown together.'
      : 'CUDA graphs, activations, the CUDA context and communication buffers: everything on the GPU besides weights and KV cache.';
    setText(r.lr, s.total ? gibStr(s.other) : dash);

    setNum(r.ram, m.ramBytes, v => gibStr(v));
    const ramPct = m.ramBytes && m.ramLimitBytes ? Math.max(1, m.ramBytes / m.ramLimitBytes * 100) : 0;
    r.ramBar.style.width = ramPct + '%';
    setText(r.ramSub, m.ramLimitBytes ? 'of ' + gibStr(m.ramLimitBytes) + ' GiB' : '');

    setText(r.ttft, ms(m.ttftMs)); setText(r.itl, ms(m.itlMs));
    setText(r.bestTtft, ms(m.bestTtftMs)); setText(r.bestItl, ms(m.bestItlMs));
    setText(r.hit, m.cacheHit === undefined ? dash : m.cacheHit.toFixed(0) + '%');

    const foot = [m.engine === 'vllm' ? 'vLLM' : 'SGLang', m.source, hostPort(m.endpoint)].join(' \\u00b7 ');
    r.foot.innerHTML = '<span>' + esc(foot) + '</span>' + (m.message ? '<span class="msg ' + (m.status === 'error' ? 'err' : '') + '">' + esc(m.message) + '</span>' : '');
  }

  /** Human labels for each failure kind; the long sentence comes from the extension. */
  const KIND = { starting: ['Starting', 'warn'], refused: ['Offline', ''], reset: ['Restarting', 'warn'], timeout: ['Not responding', 'warn'],
    auth: ['Auth failed', ''], server: ['Server error', ''], dns: ['Bad URL', ''], notfound: ['Not found', ''], nometrics: ['No metrics', 'warn'], other: ['Error', ''] };
  const ago = t => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago'; };

  function renderAlert(c, m) {
    const r = c.r, k = m.errorKind ? (KIND[m.errorKind] || KIND.other) : null;
    r.cStatus.hidden = !k;
    if (k) { setText(r.cStatus, k[0]); r.cStatus.className = 'chip st ' + k[1]; }
    r.alert.hidden = !m.message || !k;
    if (!r.alert.hidden) {
      r.alert.className = 'alert ' + (k[1] || '');
      r.alert.innerHTML = esc(m.message) +
        (m.offline ? '<small>' + (m.lastOkAt ? 'Last data ' + '<span data-ago="' + m.lastOkAt + '">' + ago(m.lastOkAt) + '</span>' : 'No data received yet') +
          (m.failures > 1 ? ' \u00b7 ' + m.failures + ' failed attempts' : '') + ' \u00b7 retrying automatically</small>' : '');
    }
  }
  // keep "x seconds ago" honest between polls
  setInterval(() => document.querySelectorAll('[data-ago]').forEach(n => { n.textContent = ago(Number(n.dataset.ago)); }), 1000);

  function toggle(card) {
    const wasOpen = card.classList.contains('open');
    cards.forEach(c => c.el.classList.remove('open'));   // only one model stays open
    open.clear();
    if (!wasOpen) { card.classList.add('open'); open.add(card.dataset.key); }
    vscode.setState({ open: JSON.stringify([...open]) });
  }
  $('cards').addEventListener('click', e => { const t = e.target.closest('.top'); if (t) toggle(t.parentElement); });
  $('cards').addEventListener('keydown', e => {
    const t = e.target.closest('.top');
    if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(t.parentElement); }
  });

  /* ---------- banners, empty state, watchdog ---------- */
  function showBanner(level, text, action) {
    const label = action === 'openSettings' ? 'Open settings' : action === 'retry' ? 'Retry' : '';
    $('banner').innerHTML = '<div class="banner ' + (level === 'error' ? 'err' : level === 'info' ? 'info' : '') + '" role="alert"><div class="bt">' + esc(text) + '</div>' +
      (label ? '<button data-act="' + action + '">' + label + '</button>' : '') + '</div>';
  }
  const clearBanner = () => { $('banner').innerHTML = ''; };
  document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) vscode.postMessage({ type: b.dataset.act }); });
  $('emptyBtn').dataset.act = 'openSettings';

  let lastAt = Date.now(), interval = 2000, gotAny = false;
  function setStale(on, secs) {
    $('stale').innerHTML = on ? '<div class="banner" role="status"><div class="bt">No update from the extension for ' + secs + 's. Showing the last known values.</div><button data-act="retry">Retry</button></div>' : '';
    cards.forEach(c => c.el.classList.toggle('stale', on));
  }
  setInterval(() => {
    if (!gotAny) return;
    const secs = Math.round((Date.now() - lastAt) / 1000);
    setStale(secs * 1000 > Math.max(interval * 4, 10000), secs);
  }, 2000);

  /* a theme switch: VS Code swaps the CSS variables; this also redraws the charts and tags the body */
  function onTheme(kind) {
    document.body.dataset.themeKind = String(kind);
    cards.forEach(c => { try { c.big.render(1); c.mini.render(1); } catch (_) { /* chart not drawn yet */ } });
  }
  new MutationObserver(() => onTheme(document.body.className)).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  window.addEventListener('message', e => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'theme') { onTheme(msg.kind); return; }
    if (msg.type === 'error') { lastAt = Date.now(); gotAny = true; setStale(false); showBanner('error', msg.message, 'retry'); return; }
    if (msg.type !== 'models' || !Array.isArray(msg.models)) return;
    lastAt = msg.at || Date.now(); interval = msg.interval || interval; gotAny = true; setStale(false);
    if (msg.notice) showBanner(msg.notice.level, msg.notice.text, msg.notice.action); else clearBanner();
    const models = msg.models;
    $('empty').hidden = models.length > 0;
    $('head').hidden = models.length === 0;
    $('count').textContent = models.length;
    if (!models.length) {
      const dockerDown = msg.notice && /Docker/.test(msg.notice.text);
      $('emptyTitle').textContent = dockerDown ? 'Docker is not reachable' : 'No servers found';
      $('emptyBody').textContent = dockerDown ? 'The monitor cannot list containers, and no extra endpoints are configured.' : 'No running vLLM or SGLang container was detected.';
      $('emptyHints').hidden = !!dockerDown; $('emptyBtn').hidden = false;
    }

    const live = new Set(models.map(m => m.key));
    for (const [k, c] of cards) if (!live.has(k)) { c.el.remove(); cards.delete(k); }
    const list = $('cards');
    models.forEach((m, i) => {
      try {
        let c = cards.get(m.key);
        if (!c) { c = build(m); cards.set(m.key, c); }
        if (list.children[i] !== c.el) list.insertBefore(c.el, list.children[i] || null);
        update(c, m);
      } catch (err) {
        // one broken card must never take the whole panel down
        console.error('card render failed', m && m.key, err);
      }
    });
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
