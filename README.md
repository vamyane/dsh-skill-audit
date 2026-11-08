# dsh-skill-audit

**Skill and plugin audit console for DeepSeek Harness.** Two modes in one panel:

1. **DSH assets** — scan local DSH skills and plugins, score each asset 0-100 (S/A/B/C/D), list every pass/warn/fail check with a fix hint, export a Markdown report.
2. **WorkBuddy package** — audit a WorkBuddy **skill package** or **expert package** (directory or `.zip`) with the **25 gate checks** (G01–G19 / E01–E06), a **quality score Q** (5 dimensions, 22 items), a **value score V** (6 dimensions), automatic V calibration (`V_final = min(V_raw, Q + 15)`) and a **suggested price band**.

`dsh-skill-audit` is a DSH plugin (`dsh.bundle` + a browser half): it mounts a **🛡️ Audit** button in the left sidebar and a full-screen React panel (no iframe). The host half does the scanning and serves the JSON routes.

## What it scans

### DSH mode

| Source | What is picked up |
| --- | --- |
| `~/.dsh/skills/*` | every skill directory (`SKILL.md`) |
| `<profile>/node_modules/*` | installed packages whose `package.json` declares `dsh.bundle` (scoped packages included) |
| `<workspace>/dsh-plugins/*` | plugins under development in the current workspace |

### WorkBuddy mode

| Input | Detection |
| --- | --- |
| directory or `.zip` | **skill package** when `SKILL.md` is at the package root (a single wrapper top directory is auto-unwrapped and then flagged by G01) |
| directory or `.zip` | **expert package** when `.codebuddy-plugin/plugin.json` exists (a ZIP must have one top directory equal to the package name) |

ZIPs are read in pure JS: the central directory is parsed and entries are inflated with `zlib.inflateRawSync` (stored + deflate). Nothing is written to disk unless script syntax checking needs a temporary copy of the scripts — that temp directory is removed immediately afterwards. ZIP64 and encrypted archives are not supported.

## DSH mode checks

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

DSH score = weighted pass ratio (pass = 1, warn = 0.5, fail = 0, skip not scored). Grades: **S ≥ 90, A ≥ 80, B ≥ 70, C ≥ 60, D < 60**.

## WorkBuddy mode checks

25 gate checks, ported from `skill-value-auditor/rubric/rubric.v1.json` (rubric v1.0.1). Every check returns `pass` / `warn` / `fail` / `skip` with a severity (`blocker` / `major` / `minor`), a readable reason, evidence, and the rubric's fix hint.

| ID | Severity | Check |
| --- | --- | --- |
| G01 | blocker | package structure (flat ZIP, `SKILL.md` at root, depth ≤ 2, no junk files; expert ZIP top dir = package name) |
| G02 | blocker | `SKILL.md` frontmatter required fields (`name`/`description`/`version`; for expert-embedded skills `name`/`description`) |
| G03 | major | `name` equals package name and is kebab-case |
| G04 | blocker | display-name rules (≤ 15 chars, only Chinese/English/digits/`-`/`—`, no brackets or spaces) |
| G05 | blocker | files referenced in backticks inside docs must exist (wildcards are rejected) |
| G06 | blocker | no hard-coded keys / tokens / private keys (values redacted) |
| G07 | blocker | YAML frontmatter parses (including the `': '` quote trap) |
| G08 | blocker | paid package legal files: `LICENSE-USE` / `NOTICE` / `PRIVACY` / `SECURITY` / `CHANGELOG` + a disclaimer |
| G09 | minor | icon asset is a 512x512 PNG ≤ 500 KB |
| G10 | major | bilingual fields (`description_en`, `display_name_en`, `examples_en`) |
| G11 | blocker | script syntax compiles (`node --check` for JS, Python `ast.parse` when a Python interpreter is available) |
| G12 | blocker | no destructive / over-privileged commands (`rm -rf /`, registry, browser credentials …) |
| G13 | major | no absolute promises (保本 / 稳赚 / 零风险 / 包过 / 避税 …) |
| G14 | major | no unfinished placeholders (TODO / 待补 / TBD …) |
| G15 | minor | UTF-8 without BOM |
| G16 | blocker | no data exfiltration (upload / webhook patterns) |
| G17 | major | package size < 3 MB (expert packages < 10 MB) |
| G18 | major | author field |
| G19 | blocker | `examples_zh` / `examples_en` each ≤ 3 entries (platform parse limit) |
| E01 | blocker | `plugin.json` has all 16 required fields and they are valid |
| E02 | blocker | avatar is 512x512 and ≤ 500 KB |
| E03 | blocker | `tags` = 3, `quickPrompts` = 3, `defaultInitPrompt` aligned, profession non-empty |
| E04 | major | `displayDescription.zh` is 40–50 characters |
| E05 | blocker | `agents/*.md` frontmatter matches `agentName` (name/description/displayName/profession/maxTurns, no `tools`) |
| E06 | blocker | Team-type `settings.json` / `teamInfo` consistency |

### Quality Q (0–100, five dimensions)

| Dimension | Weight | What it looks at |
| --- | --- | --- |
| Q1 structural / engineering robustness | 18 | gate result, script presence and static syntax, self-check, version/changelog/size/encoding |
| Q2 triggering and routing | 14 | description coverage of example questions, generic words, name searchability, example quality |
| Q3 workflow executability | 24 | numbered steps and branches, input collection + graceful degradation, output templates, uncertainty boundaries |
| Q4 knowledge quality | 26 | knowledge density, static consistency, dates/sources, disclaimers, reusable assets |
| Q5 experience / commercial basics | 18 | first-run deliverable, bilingual listing copy, export formats, token efficiency |

Each of the 22 items is scored on a 0–4 anchor scale, scaled to its max, and **every item carries evidence** (counts, files, matched words). The report prints all of it.

### Value V (0–100, six dimensions) and pricing

| Dimension | Weight | Basis |
| --- | --- | --- |
| V1 demand strength | 25 | domain demand prior + loss/event/frequency/decision/search word density |
| V2 delivery certainty | 20 | tables, scripts, templates, acceptance criteria |
| V3 result value | 20 | domain loss baseline + money / fine / claim words |
| V4 moat / substitutability | 15 | knowledge size, tables, scripts, formulas, compliance hooks, minus generic words |
| V5 reuse frequency | 10 | domain frequency prior + periodic vs one-time words |
| V6 willingness to pay / risk | 10 | domain, disclaimer presence, compliance signals |

**Calibration:** `V_final = min(V_raw, Q + 15)` — a package cannot be "valuable" if its delivery is weak.
**Price bands** (by `V_final`): S ≥ 85 → ¥49–79 or subscription; A ≥ 72 → ¥29.9; B ≥ 60 → ¥19.9; C ≥ 48 → ¥9.9; otherwise free / do not list. If V5 ≥ 80 and V ≥ 70 a monthly subscription (¥9.9–19.9/month) is suggested. Gate blockers force `V_final = 0` and no pricing.

**Penalties** (P1–P6) are applied as cross-dimension deductions and listed separately: duplicate lines > 30 %, missing disclaimer in a professional domain, absolute claims, sibling similarity (needs a batch corpus, reported as not triggered), oversized package/text, placeholders.

## Using the panel

1. Install the plugin (plugin market, or drop it into the profile and add its bundle row).
2. Click **🛡️ Audit** at the bottom of the left sidebar.
3. **DSH assets** tab: scans on open, **↻ Rescan**, expandable rows, filter tabs, **⬇ Export report** → `<workspace>/outputs/skill-audit-<YYYY-MM-DD>.md`.
4. **WorkBuddy** tab: paste an absolute path to a package directory or `.zip`, click **🔍 Scan package**; the panel shows the gate table grouped by severity, Q dimensions, V dimensions, penalties and the price band. **⬇ Export report** → `<workspace>/outputs/wb-audit-<name>-<YYYY-MM-DD>.md`.
5. **Static preview** opens the bundled `app/panel.html` preview page in a new tab (design reference only, sample data).

### Host routes

| Route | Method | Description |
| --- | --- | --- |
| `/api/dsh-skill-audit/scan` | GET | DSH scan JSON; optional `?workspace=<absolute path>` hint |
| `/api/dsh-skill-audit/report` | POST | DSH scan + Markdown report; optional body `{ "workspace": "<absolute path>" }` |
| `/api/dsh-skill-audit/wb-scan` | POST | WorkBuddy package scan; body `{ "path": "<absolute path>", "paid"?: true/false, "skipScripts"?: true }` |
| `/api/dsh-skill-audit/wb-report` | POST | WorkBuddy scan + Markdown report; body `{ "path": "...", "workspace"?: "..." }` |

All routes sit on the shared `/api` channel of the host `connection` service, so login and origin checks are handled by DSH. WorkBuddy scans are read-only; the only writes are the exported reports under `<workspace>/outputs/`.

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
# DSH assets
node tools/scan.mjs                          # scan the machine, workspace = cwd
node tools/scan.mjs --workspace .            # specify the workspace
node tools/scan.mjs --asset ~/.dsh/skills/ai-brain   # audit one DSH asset
node tools/scan.mjs --json                   # machine-readable output
node tools/scan.mjs --report report.md       # also write a Markdown report

# WorkBuddy packages
node tools/scan.mjs --wb E:/skills/release/my-skill-1.0.0.zip
node tools/scan.mjs --wb E:/workspace/my-expert --json
node tools/scan.mjs --wb <path> --paid       # force paid-package legal checks
node tools/scan.mjs --wb <path> --skip-scripts   # skip static script syntax checks
node tools/scan.mjs --wb <path> --report wb-report.md
```

`--wb` exits with code `1` when the package has gate blockers, `0` otherwise (useful in CI).

## Development

```bash
node build.mjs          # gzip app/panel.html into lib/client.js
node test/smoke.mjs     # offline smoke: gzip payload, slots, both panel modes, host routes
node test/scan.test.mjs # DSH mode fixtures + route integration
node test/wb.test.mjs   # WorkBuddy fixtures (good/bad skill & expert, dir + zip) + Q/V + routes
npm test                # all three
npm pack --dry-run      # inspect the published file set
```

Layout:

```
lib/index.js            host half (4 routes, cordis plugin entry)
lib/audit.mjs           DSH scan / score / Markdown logic
lib/wb-package.mjs      WorkBuddy package reader (ZIP central directory, dir view, YAML subset)
lib/wb-audit.mjs        WorkBuddy gate checks + Q/V + pricing + Markdown report
lib/client.template.js  browser half template (React panel, two slots, two modes)
lib/client.js           generated by build.mjs (do not edit)
app/panel.html          static preview page, gzipped into lib/client.js
tools/scan.mjs          CLI (DSH + WorkBuddy)
tools/make-icon.py      generates assets/icon.png with Pillow
test/                   smoke + DSH scan tests + WorkBuddy tests
```

## Privacy and safety

- Scans are **read-only**: they never modify the scanned skills/plugins/packages, and they make no network calls.
- The only writes are the exported reports under `<workspace>/outputs/` (plus a temporary copy of package scripts while `node --check` / Python AST runs, removed immediately).
- Secret matches are reported as a type and a count only; the matched value is never copied into the JSON or the Markdown report.
- Local paths are reported as a count; usernames are not echoed back.
- Everything stays on this machine and is only shown to the local DSH panel.

## Known limitations

- WorkBuddy scoring is a **heuristic static approximation**, not a model or a human reviewer: gate checks are deterministic, Q/V use word/structure heuristics. Every score in the report carries its evidence so it can be audited, but treat Q/V as guidance, not truth.
- YAML parsing is a small subset parser (scalars, block scalars, lists, simple nested maps) — unusual YAML may be rejected or under-read.
- G11 only checks static syntax (`node --check`, Python `ast.parse`); scripts are **not executed**, so `--demo` / selfcheck exit codes / T1 sandbox runs are not verified.
- T3 sibling-package similarity and T4 behaviour scoring are not automated (they need a batch corpus and real agent output); P4 is reported as not triggered.
- DSH icon validation only understands PNG headers; SVG/JPG icons get a warning.
- Report file names are date-based, so two exports on the same day overwrite each other.
- WorkBuddy ZIP support covers stored/deflate, no ZIP64/encryption; packages must be readable by the DSH host process (absolute path).
- Paid-package detection is heuristic (legal files / price fields / `--paid`); it may miss a paid package that ships no legal files.
- In a browser host where the session list is unavailable, workspace detection falls back to environment/config/cwd as described above.

## License

MIT. See [LICENSE](LICENSE).
