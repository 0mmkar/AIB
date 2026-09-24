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

_Last updated: 2026-09-24 · Iteration 1_

- **Direction:** all demo logic is being discarded. Everything follows `Claude_Data/` only.
  The UI keeps its visual design. Decisions D1–D7 are in DEV_LOG.md §3.
- **Branch:** work happens on `feature/real-bancs-data`. **Never commit to `main`.**
  `Claude_Data/` is committed on this branch (the user's decision).
- **Done:** the new SLA engine in `server/engine/` reproduces `SLA_Expected_Results.xlsx`
  exactly (`npm run verify:real` gives 0 diffs, csv and xlsx). `npm test` passes 8/8.
- **Not yet wired:** the API and UI still run the old demo pipeline. Iteration 2 swaps the
  backend and deletes the demo code. Iteration 3 moves the UI onto the new data, and
  Iteration 4 does the same for Intelligence.

---

## Commands

```bash
npm install          # first — node_modules is not committed
npm run dev          # API :5174 + Vite UI :5173
npm run demo         # rebuild the synthetic demo history (stop the server first on Windows)
npm run reset        # close every period
npm run preview      # build the UI and serve everything from :5174
```

```bash
npm run verify:real     # engine vs SLA_Expected_Results.xlsx; must report 0 diffs
npm test                # engine unit tests (node:test)
npm run mapping:extract # regenerate config/mapping-23b.json from the workbook
```

`npm run demo` / `seed` / `reset` belong to the old demo and are being removed in Iteration 2.

## Architecture map

| Area | Files |
|---|---|
| Ingest → pack pipeline | [server/pipeline.js](server/pipeline.js) (`ingest`, `generate`) |
| File parsing (xlsx / csv / pdf → one doc shape) | [server/parse.js](server/parse.js) |
| Content-only classification, solved as a set | [server/classify.js](server/classify.js) + [config/source-templates.json](config/source-templates.json) |
| Per-source metric adapters | [server/adapters/](server/adapters/) |
| RAG scoring | [server/slaEngine.js](server/slaEngine.js) + [config/sla-metrics.json](config/sla-metrics.json) |
| Data-quality flags | [server/dataQuality.js](server/dataQuality.js) |
| Storage (`data/uploads`, `data/analyses`) | [server/store.js](server/store.js) |
| Phase 2 intelligence / narrative / Q&A | [server/intelligence.js](server/intelligence.js), [server/narrative.js](server/narrative.js), [server/assistant.js](server/assistant.js) |
| API routes | [server/index.js](server/index.js) |
| UI | [src/App.jsx](src/App.jsx), [src/views/](src/views/), [src/components/](src/components/) |
| Synthetic data generators (old demo, to be deleted) | [scripts/](scripts/) (`seed.js`, `scenario.js`, `generators/`) |
| **New SLA engine (real data)** | [server/engine/](server/engine/): `extracts` → `workflows` → `rules` → `engine.evaluate()` |
| SLA definitions, calendar, 23B mapping | [config/sla-schedule.json](config/sla-schedule.json), [config/mapping-23b.json](config/mapping-23b.json) |
| Acceptance harness | [scripts/verify-real.js](scripts/verify-real.js) |

## Project rules

- **Classification uses content only.** Filenames are never inspected. This holds for the
  real extracts too: derive the source type and the extract (as-of) date from content.
- **No model-generated numbers.** Every SLA figure comes from deterministic code. The
  narrative and assistant only phrase pre-computed figures, and the fabrication guard
  enforces that.
- **One current pack per month.** Regenerating overwrites; there are no parallel drafts.
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
- The user does **not** want changes on `main`. Work and commit on
  `feature/real-bancs-data`, or another feature branch.

**Environment (Windows)**
- Stop the server before `npm run demo` / `reset`, because open handles block deletes
  (see README).
- Python prints to a cp1252 console, so set `PYTHONIOENCODING=utf-8` when printing
  workbook text.
- There is no pandas or openpyxl. Use `exceljs` via Node (`npm install` has now been run).
- Node 24: `node --test <dir>` fails with MODULE_NOT_FOUND. Pass a glob:
  `node --test "server/**/*.test.js"`.
- The Grep tool (ripgrep) rejects nested brace globs.
