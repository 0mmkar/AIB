# CLAUDE.md — AIB Life SLA Governance

SLA governance prototype: source extracts go in; they are classified from content, scored
against contracted SLAs, and published as one governance pack per reporting month. The
Phase 2 intelligence layer (trends, breach risk, recurring causes, narrative, Q&A) runs on
that history. Full product description: [README.md](README.md).

**Current initiative:** integrating the real-format TCS BaNCS extracts in `Claude_Data/`.
The plan, the analysis and the iteration history all live in **[DEV_LOG.md](DEV_LOG.md)**.
Read it before starting work.

---

## Iteration logging protocol (MANDATORY)

The user requires a written trail of every change and every error. At the **end of every
iteration**, meaning any turn that changes code, config or data, or that hits an error, do
all four steps before the final reply:

1. **Append an entry** to the *Iteration log* in [DEV_LOG.md](DEV_LOG.md), using the format
   of the existing entries:
   - iteration number, date (absolute, `YYYY-MM-DD`) and goal
   - **Changes:** each file touched and what changed in it
   - **Errors faced:** a table with columns # · symptom · root cause · fix. An error is
     anything that failed: a command, a test, an oracle diff, a wrong assumption or a
     reverted approach. Write "None" only when that is literally true.
   - **Verification:** the commands actually run and their actual result. Report failures
     as failures.
   - **Next:** the concrete next step.
2. **Update the plan** in DEV_LOG.md §3:
   - tick or flag status boxes (`[ ]` `[~]` `[x]` `[-]`)
   - add newly discovered tasks
   - when the plan changes, say why in the iteration entry
3. **Update this file:** refresh *Current status* below, and add any newly learned trap to
   *Known pitfalls* so no later session repeats it.
4. Mention in the final reply that DEV_LOG.md and CLAUDE.md were updated.

Keep entries factual and short. Never rewrite earlier entries. If one turns out to be wrong,
add a correction in the new entry.

---

## Current status

_Last updated: 2026-09-25 · Iteration 4_

- **Direction:** all demo logic is discarded. Everything follows `Claude_Data/` only. The UI
  keeps its visual design. Decisions D1–D7 are in DEV_LOG.md §3.
- **Branch:** the working branch is **`Ommkar`**. HEAD was switched to it at 15:00:38 on
  2026-09-24, outside Claude's commands. It holds every commit of this initiative.
  `feature/real-bancs-data` stops at Iteration 1. **Never commit to `main`.**
- **Done (plan phases A–E complete):**
  - The engine reproduces `SLA_Expected_Results.xlsx` exactly (0 diffs, csv and xlsx).
  - The backend builds 22 monthly packs from the extract set, auto-loaded on a cold start.
  - Every screen runs on the real data with the original design: Dashboard, Extracts, SLA
    position, Exceptions, Governance pack, and Intelligence (including the guarded Bedrock
    narrative and Q&A).
  - README rewritten. `npm test` passes 24/24.
- **Presenter's briefing** (Iteration 4, private):
  https://claude.ai/artifact/PrWoChV2v16Ez4eKeemUr2. It covers architecture, data flow,
  proof, demo script and Q&A. Republish from the same conversation, or pass that URL, to
  update it.
- **Open:**
  - user review; merging or opening a PR is the user's decision
  - before real extracts: DEV_LOG.md Phase F. F1 is a header-less EBQ reader, F2 is to
    extend the holiday calendar past 2026-08-03.

---

## Commands

```bash
npm install             # first — node_modules is not committed
npm run dev             # API :5174 + Vite UI :5173 (server auto-loads Claude_Data/ if empty)
npm run data:load       # import Claude_Data/ and rebuild all monthly packs (stop the server first)
npm run reset           # clear the imported set, packs and narrative cache
npm run preview         # build the UI and serve everything from :5174
npm run verify:real     # engine vs SLA_Expected_Results.xlsx; must report 0 diffs
npm test                # unit tests (node:test): calendar boundaries, narrative guards
npm run mapping:extract # regenerate config/mapping-23b.json from the workbook
npm run bedrock:check   # diagnose Bedrock access
```

## Architecture map

```
Claude_Data/*.csv|xlsx ─▶ engine/extracts (identify by columns) ─▶ engine/workflows (union open+closed,
  as-of date) ─▶ engine/rules (23A, 23B NUL/UL 1-3, 23C, 23E → item outcomes) ─▶ engine/engine (monthly
  roll-up) ─▶ pipeline.rebuild ─▶ data/analyses/<month>.json + data/snapshot.json ─▶ API ─▶ UI
```

| Area | Files |
|---|---|
| SLA definitions, calendar, 23B mapping | [config/sla-schedule.json](config/sla-schedule.json), [config/mapping-23b.json](config/mapping-23b.json) |
| SLA engine (pure, no I/O except config) | [server/engine/](server/engine/): `datetime`, `calendar`, `extracts`, `workflows`, `rules`, `outcome`, `engine` |
| Extract set → monthly packs | [server/pipeline.js](server/pipeline.js), [server/slots.js](server/slots.js) |
| Data-quality findings | [server/quality.js](server/quality.js) |
| Failure concentration (drivers) | [server/insights.js](server/insights.js) |
| Storage (`data/extracts`, `data/analyses`, `data/snapshot.json`) | [server/store.js](server/store.js) |
| Intelligence / narrative / Q&A | [server/intelligence.js](server/intelligence.js), [server/narrative.js](server/narrative.js), [server/assistant.js](server/assistant.js) |
| API routes | [server/index.js](server/index.js) |
| UI (design kept) | [src/App.jsx](src/App.jsx) (routing), [src/views/](src/views/) (Dashboard, Extracts, Position, Exceptions, Pack, Intelligence), [src/components/](src/components/), [src/styles.css](src/styles.css) |
| Acceptance harness | [scripts/verify-real.js](scripts/verify-real.js) |

## Project rules

- **Classification uses content only.** Filenames are never inspected. This holds for the
  real extracts too: derive the source type and the extract (as-of) date from content.
- **No model-generated numbers or claims.** Every SLA figure comes from deterministic code. The
  narrative and assistant only phrase pre-computed figures. Two guards enforce this:
  `unsupportedFigures` (every number must be in the input) and `contradictedClaims` (no
  inverted pass/fail).
- **No invented logic.** Rules, targets, holidays and mapping come from the workbook. No
  forecasts, amber bands or service credits, because the data defines none of them.
- **One current pack per month.** The packs are derived from the whole extract set, and a
  rebuild replaces all of them. One current file per slot: a new upload for a filled slot
  supersedes the old one.
- **The oracle is the definition of done.** Engine work on the real data is complete only
  when `Claude_Data/SLA_Expected_Results.xlsx` reproduces with zero diffs.
- Match the surrounding code style: ES modules, small pure functions, explanatory block
  comments where a rule is non-obvious.

## Known pitfalls

Add to this list whenever something bites.

**Real BaNCS data**
- Date cells in the `.xlsx` extracts are Excel date-times. `parse.js` `cellText()`
  currently truncates them to `YYYY-MM-DD`, which **drops the time** needed for the 3pm and
  48h rules. In the `.csv` files they are `dd/mm/yyyy hh:mm:ss` strings.
- Treat all timestamps as **UTC wall-clock** (Irish local time, never converted). Never use
  local-time `Date` methods.
- The extracts are **multi-month snapshots** (2024-12 → 2026-09), not monthly files.
  `detectMonth` / `month_mismatch` logic does not apply to them.
- The two `WRKFLWEXT` files have identical columns. Tell them apart by content
  (Status `In Progress` + `Pending Since Days` vs Status `Closed` + `Close Date`).
- The 23B mapping has these quirks:
  - lowercase code `Ul`
  - a trailing space in a transaction name
  - duplicate rows
  - the spelling `Infletion`

  The mapping joins on Transaction (col B) + Product.
- `Request ID` has lost 2 digits of precision, so it is not a join key. WITHDRAWALEXT
  contains the literal string `nan`.
- The 23E workflow type must *start with* `Manual Review` (the real values carry
  suffixes). The phrase match ignores case, and `Recognized` decoys must not match.
- Open items are OPEN - PAST DEADLINE only when the deadline day is **before** the extract
  date. An item whose deadline is the extract date is NOT YET DUE.
- The extract date comes from content: open workflow Created Date + Pending Since Days
  = 2026-09-24.
- The workbook's `Monthly summary` is COUNTIFS formulas. **ExcelJS drops cached results that
  are falsy** (`0` or `""`), so a formula cell with no `result` means 0 or blank.
- Merged cells: ExcelJS repeats the master value on every cell of a merge, so take the
  first occurrence.
- ExcelJS `row.values` is truncated after the last filled cell. Read cells by index with
  `row.getCell(n)`.

**Project rules for git**
- The user does **not** want changes on `main`. Commit on the current feature branch
  (`Ommkar`). Run `git branch --show-current` before every commit, and never switch
  branches without being asked.

- A pass/fail figure can be real and still stated backwards. The Bedrock narrative once said
  23C failed at 96.97% (target 96%). Keep met/missed as explicit lists in any model brief.
- Drivers: a big group failing at about the average rate is not a concentration. Require
  at least 1.25× the SLA rate, and rank by excess failures.
- Each extract ships as both .csv and .xlsx. Never load both, or every record counts twice.
  The slot model enforces this.

- Identify extracts from the **first worksheet only**. The expected-results workbook's
  '23B UL Step 2' tab carries every WITHDRAWALEXT column, and it once replaced the real
  extract. It is now rejected explicitly.
- Charts: a month with one or two completed items can sit at 0%. Clip such values at the
  axis with a label rather than letting them set the scale.
- **The real EBQ report has no header row.** The synthetic copy in `Claude_Data/` has one
  added (see the workbook README). Header-based identification will reject the real file.
  This is Phase F1.
- The holiday calendar is exactly the workbook's list and ends 2026-08-03. Extend it
  before loading later extracts (Phase F2).
- Verification scale, for quoting: 14,898 rows per format (six tabs) plus 176
  month-by-SLA results. It is not 16,898.

**UI conventions**
- Reuse the design system's classes and tokens (`card`, `stat`, `table`, `rag-*`,
  `scope-chip`, `cluster-row`, ...). Add CSS only in the small "SLA table and item lists"
  block.
- Check layout with headless Edge screenshots at 1440 px:
  `msedge --headless=new --window-size=1440,1800 --virtual-time-budget=9000 --screenshot=out.png http://localhost:5174/#2026-08/position`

**Environment (Windows)**
- Stop the server before `npm run data:load` / `reset`, because open handles block deletes.
- Tracked text files have **CRLF** line endings in the working copy (autocrlf). A
  `
`-anchored regex edit silently matches nothing, so use the Edit tool or normalise first.
- Do not pass regex-bearing code through bash heredocs into JS template strings, because
  the escapes get mangled. Use the Edit tool.
- Python prints to a cp1252 console, so set `PYTHONIOENCODING=utf-8` when printing
  workbook text.
- Artifact publishing: use the long temp path `C:\Users\OmmkarBisoi\AppData\Local\Temp\…`.
  The 8.3 short form `OMMKAR~1` is blocked by the Read permission rule for supporting
  files.
- Headless Edge renders pages in the dark theme by default. Check both themes when it
  matters.
- There is no pandas or openpyxl. Use `exceljs` via Node (`npm install` has now been run).
- Node 24: `node --test <dir>` fails with MODULE_NOT_FOUND. Pass a glob:
  `node --test "server/**/*.test.js"`.
- The Grep tool (ripgrep) rejects nested brace globs.
