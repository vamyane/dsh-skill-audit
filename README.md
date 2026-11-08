# dsh-skill-audit

**Skill and plugin audit console for DeepSeek Harness.** Scan the skills and plugins on your machine, score each asset 0-100 (S/A/B/C/D), see every pass / warn / fail check with a fix hint, and export a Markdown report.

`dsh-skill-audit` is a DSH plugin (`dsh.bundle` + a browser half) that mounts a **🛡️ Audit** button in the left sidebar and a full-screen React panel. The host half does the scanning and serves two JSON routes; the panel never uses an iframe.

## What it scans

| Source | What is picked up |
| --- | --- |
| `~/.dsh/skills/*` | every skill directory (`SKILL.md`) |
| `<profile>/node_modules/*` | installed packages whose `package.json` declares `dsh.bundle` (scoped `@scope/pkg` included) |
| `<workspace>/dsh-plugins/*` | plugins under development in the current workspace |

The active profile is taken from `DSH_PROFILE_DIR` (fall back to every directory under `~/.dsh/profiles/`); `DSH_HOME` overrides `~/.dsh`.

## Checks

### Skills (`SKILL.md` based)

| Check | Weight | What is verified |
| --- | --- | --- |
| `SKILL.md` | 20 | file exists and is not empty |
| frontmatter `description` | 20 | YAML frontmatter present, `description` present and substantial |
| frontmatter `author` | 10 | author declared |
| frontmatter `name` | 10 | matches the directory name |
| `LICENSE` | 10 | license file (or a license declared in frontmatter) |
| sensitive info | 20 | obvious keys / tokens / private keys (values are redacted) |
| local paths / privacy | 10 | hard-coded home directories such as a full user path |

### Plugins (`package.json` based)

| Check | Weight | What is verified |
| --- | --- | --- |
| `package.json` | 5 | readable, valid, `name` matches the directory |
| `dsh.bundle` | 15 | declared, `patch` file exists |
| `cordis.patch.yml` row name | 15 | the inserted row's `name` equals the package name |
| client module id | 10 | `__ModuleLoader__.load({ id })` equals the package name |
| host module name | 10 | `export const name` / `exports.name` equals the package name |
| `README` | 5 | at least one README |
| bilingual README | 5 | `README.md` plus `README.zh.md` / `README.en.md` |
| `LICENSE` | 7 | license file exists |
| icon | 10 | `icon` is a 512x512 PNG (dimensions read from the PNG header) |
| `files` whitelist | 5 | covers lib/app/assets/README\*/LICENSE/`cordis.patch.yml` |
| sensitive info | 10 | obvious keys / tokens / private keys (values are redacted) |
| local paths / privacy | 3 | hard-coded home directories |

## Scoring

- Every check is `pass` (full weight), `warn` (half weight), `fail` (zero) or `skip` (not scored).
- Score = weighted pass ratio, 0-100. Grades: **S ≥ 90, A ≥ 80, B ≥ 70, C ≥ 60, D < 60**.
- Assets are sorted worst-first, and each problem comes with a concrete fix hint.

## Using the panel

1. Install the plugin (via the plugin market, or drop it into the profile and add its bundle row).
2. Click **🛡️ Audit** at the bottom of the left sidebar.
3. The panel scans on open. **↻ Rescan** re-runs the scan, rows expand to the full check list, the filter tabs switch between skills / plugins / all.
4. **⬇ Export report** writes `<workspace>/outputs/skill-audit-<YYYY-MM-DD>.md`.
5. **Static preview** opens the bundled `app/panel.html` preview page in a new tab (design reference only, sample data).

### Host routes

| Route | Method | Description |
| --- | --- | --- |
| `/api/dsh-skill-audit/scan` | GET | JSON scan result; optional `?workspace=<absolute path>` hint |
| `/api/dsh-skill-audit/report` | POST | scan + write the Markdown report; optional body `{ "workspace": "<absolute path>" }` |

Both routes sit on the shared `/api` channel of the host `connection` service, so login and origin checks are handled by DSH. Both are read-only apart from the report file under `<workspace>/outputs/`.

### Which workspace?

The report is exported to, and `<workspace>/dsh-plugins/*` is scanned from, the first valid candidate:

1. the current session working directory reported by the panel (most accurate),
2. the `DSH_WORKSPACE` environment variable,
3. `workspace` in `~/.dsh/skill-audit.config.json`,
4. the host process `process.cwd()`.

```json
// ~/.dsh/skill-audit.config.json
{ "workspace": "C:/path/to/your/workspace" }
```

Only an existing, non-root absolute directory is accepted; everything else silently falls back.

## CLI

The same audit logic runs without DSH:

```bash
node tools/scan.mjs                          # scan the machine, workspace = cwd
node tools/scan.mjs --workspace .            # specify the workspace
node tools/scan.mjs --asset ~/.dsh/skills/ai-brain   # audit one asset
node tools/scan.mjs --json                    # machine-readable output
node tools/scan.mjs --report report.md        # also write a Markdown report
```

## Development

```bash
npm install          # no runtime deps; only for local tooling
node build.mjs       # gzip app/panel.html into lib/client.js
node test/smoke.mjs  # offline smoke: embedded gzip, slots, components, host routes
node test/scan.test.mjs --live   # fixtures + live scan of this repo and ai-brain
npm pack --dry-run   # inspect the published file set
```

Layout:

```
lib/index.js            host half (routes, cordis plugin entry)
lib/audit.mjs           pure scan / score / Markdown logic (shared with CLI and tests)
lib/client.template.js  browser half template (React panel, two slots)
lib/client.js           generated by build.mjs (do not edit)
app/panel.html          static preview page, gzipped into lib/client.js
tools/scan.mjs          CLI
tools/make-icon.py      generates assets/icon.png with Pillow
test/                   smoke + scan tests
```

## Privacy and safety

- The scan is **read-only**: it never modifies the scanned skills or plugins, and it makes no network calls.
- The only write is the exported report under `<workspace>/outputs/`.
- Secret matches are reported as a type and a count only; the matched value is never copied into the JSON or the Markdown report.
- Local paths are reported as a count; usernames are not echoed back.
- What is scanned stays on this machine and is only shown to the local DSH panel.

## Known limitations

- Checks are static (regex / header parsing), not a full YAML or JS parser: unusual `cordis.patch.yml` layouts may be reported as not detected, and minified host bundles may hide the `name` declaration.
- Icon validation only understands PNG headers; SVG/JPG icons get a warning that they cannot be verified at 512x512.
- Report file names are date-based, so two exports on the same day overwrite each other.
- `npm pack` contents are not executed here; the `files` whitelist is checked statically.
- In a browser host where the session list is unavailable, workspace detection falls back to environment/config/cwd as described above.

## License

MIT. See [LICENSE](LICENSE).
