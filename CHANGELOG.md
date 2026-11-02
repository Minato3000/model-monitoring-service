# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-02

First public release.

### Added
- Sidebar panel that discovers vLLM and SGLang Docker containers and shows one card per server.
- Live throughput chart with a dotted peak line and completed-request markers.
- Tokens/s, per-request tokens/s, prefill rate, running and queued requests, KV cache, host RAM, TTFT, inter-token latency (with best values seen) and prefix-cache hit rate.
- GPU memory breakdown: weights, KV used, KV free and runtime.
- Light, dark and high-contrast theme support that follows VS Code without a reload.
- Responsive layout that reflows with the panel width.
- Clear failure states: offline, starting, timeout, auth failure, missing metrics, Docker unreachable, missing `nvidia-smi`, stalled extension host.
- `llmmonitor.extraEndpoints` for servers outside Docker or on other hosts.
- Development tools: mock servers, scenario tests and a theme/state preview page.
