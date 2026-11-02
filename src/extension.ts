import * as vscode from 'vscode';
import { discoverContainers, emptyGpu, gpuInfo } from './docker';
import { pollTarget, pruneStates } from './adapters';
import { classifyError } from './prom';
import { ModelSnapshot, Notice, Target } from './types';
import { getWebviewContent } from './webview';

interface ExtraEndpoint { engine: 'vllm' | 'sglang'; url: string; name?: string; apiKey?: string }

type Outgoing =
  | { type: 'models'; models: ModelSnapshot[]; notice?: Notice; interval: number; at: number }
  | { type: 'error'; message: string; interval: number; at: number };

class LlmMonitorViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private timer?: NodeJS.Timeout;
  private busy = false;
  private last?: Outgoing;

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = getWebviewContent();

    view.webview.onDidReceiveMessage(m => {
      if (m.type === 'ready') { void view.webview.postMessage({ type: 'theme', kind: vscode.window.activeColorTheme.kind }); this.resend(); void this.tick(); }
      else if (m.type === 'openSettings') { void vscode.commands.executeCommand('workbench.action.openSettings', 'llmmonitor'); }
      else if (m.type === 'retry') { void this.tick(); }
    });
    view.onDidChangeVisibility(() => { if (view.visible) { this.start(); } else { this.stop(); } });
    const themeSub = vscode.window.onDidChangeActiveColorTheme(t => void view.webview.postMessage({ type: 'theme', kind: t.kind }));
    view.onDidDispose(() => { this.stop(); themeSub.dispose(); });
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('llmmonitor')) { this.start(); } });
    this.start();
  }

  refresh(): void { void this.tick(); }

  private start(): void {
    this.stop();
    this.timer = setInterval(() => void this.tick(), this.interval());
    void this.tick();
  }

  /** Settings can hold junk (a string, 0, a negative): fall back to something safe. */
  private interval(): number {
    const v = Number(vscode.workspace.getConfiguration('llmmonitor').get('refreshInterval', 2000));
    return Number.isFinite(v) ? Math.min(30000, Math.max(500, v)) : 2000;
  }

  private stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
  }

  private resend(): void { if (this.last) { void this.view?.webview.postMessage(this.last); } }

  private async tick(): Promise<void> {
    if (this.busy || !this.view) { return; }
    this.busy = true;
    try {
      const cfg = vscode.workspace.getConfiguration('llmmonitor');
      const socket = cfg.get<string>('dockerSocket', '/var/run/docker.sock');
      const smi = cfg.get<string>('nvidiaSmiPath', 'nvidia-smi');
      const extras = cfg.get<ExtraEndpoint[]>('extraEndpoints', []);

      let notice: Notice | undefined;
      let targets: Target[] = [];
      try { targets = await discoverContainers(socket); }
      catch (e) {
        const he = classifyError(e, 'Docker daemon');
        const fixable = he.kind === 'permission' || he.kind === 'nosocket';
        notice = { level: 'warn', text: `Docker is not reachable at ${socket}. ${he.message} Showing extra endpoints only.`, action: fixable ? 'openSettings' : 'retry' };
      }

      for (const x of Array.isArray(extras) ? extras : []) {
        if (!x || typeof x.url !== 'string' || (x.engine !== 'vllm' && x.engine !== 'sglang')) {
          notice ??= { level: 'warn', text: 'An entry in llmmonitor.extraEndpoints is invalid (needs "engine": "vllm" | "sglang" and a "url"). It was skipped.', action: 'openSettings' };
          continue;
        }
        targets.push({ key: `ext:${x.url}`, engine: x.engine, name: x.name ?? x.url, baseUrl: x.url.replace(/\/$/, ''), apiKey: x.apiKey });
      }
      pruneStates(new Set(targets.map(t => t.key)));

      const gpu = targets.some(t => t.container) ? await gpuInfo(smi) : emptyGpu();
      const models = await Promise.all(targets.map(t => pollTarget(t, socket, gpu)));
      models.sort((a, b) => a.source.localeCompare(b.source));
      this.send({ type: 'models', models, notice, interval: this.interval(), at: Date.now() });
    } catch (e) {
      this.send({ type: 'error', message: `The monitor hit an unexpected error: ${(e as Error).message}`, interval: this.interval(), at: Date.now() });
    } finally {
      this.busy = false;
    }
  }

  private send(msg: Outgoing): void {
    this.last = msg;
    void this.view?.webview.postMessage(msg);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new LlmMonitorViewProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('llmmonitor.panel', provider, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('llmmonitor.refresh', () => provider.refresh())
  );
}

export function deactivate(): void { /* timers are stopped when the view is disposed */ }
