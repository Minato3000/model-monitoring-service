# Publishing

The extension is published to two registries from the same `.vsix`:

| Registry | Used by | Tool | Token |
|---|---|---|---|
| [Visual Studio Marketplace](https://marketplace.visualstudio.com/) | VS Code | `vsce` | `VSCE_PAT` (Azure DevOps personal access token) |
| [Open VSX](https://open-vsx.org/) | VSCodium, Cursor, Gitpod, Eclipse Theia and others | `ovsx` | `OVSX_PAT` |

Both registries identify the extension as `<publisher>.<name>`, here `Minato3000.llm-monitor-service`.

## One-time setup

### Visual Studio Marketplace

1. Sign in at <https://dev.azure.com> with a Microsoft account and create an organization if you have none.
2. Create a personal access token: **User settings → Personal access tokens → New Token**.
   - Organization: **All accessible organizations**
   - Scopes: **Custom defined → Marketplace → Manage**
3. Create the publisher at <https://marketplace.visualstudio.com/manage> with ID `Minato3000`. The ID must match `publisher` in `package.json`.
4. Check the login: `npx vsce login Minato3000` (paste the token).

### Open VSX

1. Sign in at <https://open-vsx.org> with GitHub and, in your profile, accept the **Publisher Agreement**.
2. Create an access token under **Settings → Access Tokens**.
3. Claim the namespace once: `npx ovsx create-namespace Minato3000 -p <token>`.
4. Optionally verify the namespace so the extension shows as verified: follow the "Claiming namespace ownership" steps at <https://github.com/EclipseFdn/open-vsx.org/wiki/Namespace-Access>.

### GitHub secrets

In the repository, **Settings → Secrets and variables → Actions**, add:

- `VSCE_PAT`: the Marketplace token
- `OVSX_PAT`: the Open VSX token

## Releasing

1. Update `version` in `package.json` and `package-lock.json`, and add a section to `CHANGELOG.md`.
2. Commit, then check locally:
   ```bash
   npm ci
   npm run compile
   npm run test:scenarios
   npx vsce package          # inspect the file list it prints
   ```
3. Tag and create a GitHub release named `v<version>` (for example `v0.1.0`).
   The **Publish** workflow checks the tag against `package.json`, builds, publishes to both registries and attaches the `.vsix` to the release.

To publish from your own machine instead:

```bash
npx vsce publish --no-dependencies --packagePath llm-monitor-service-0.1.0.vsix -p "$VSCE_PAT"
npx ovsx publish llm-monitor-service-0.1.0.vsix -p "$OVSX_PAT"
```

The workflow can also be started by hand (**Actions → Publish → Run workflow**) to publish to one registry only, for example when one of the two failed.

## Pre-release checklist

- [ ] `version` bumped, `CHANGELOG.md` updated
- [ ] `npm run compile` and `npm run test:scenarios` pass
- [ ] README images are committed under `docs/images` (the registry rewrites relative image links to the GitHub repository, so the repository must be public and the files must be on the default branch)
- [ ] `icons/icon.png` is a PNG of at least 128×128 (the Marketplace rejects SVG icons)
- [ ] `LICENSE` is present
- [ ] The `.vsix` contains no `scripts/`, `docs/`, `src/` or source maps (`npx vsce ls`)

## Notes

- `extensionKind` is `workspace`, so over Remote-SSH, WSL or Dev Containers the extension runs on the remote machine next to Docker and the GPUs. The Docker socket and `nvidia-smi` are read there.
- `preview: true` marks the listing as a preview while the version is below 1.0. Remove it when you are ready for a stable release.
- Marketplace versions are immutable: a published version cannot be replaced, so bump the version for any fix.
- Open VSX does not allow overwriting a version either. If one registry failed, rerun only that job from the workflow dispatch form instead of re-tagging.
