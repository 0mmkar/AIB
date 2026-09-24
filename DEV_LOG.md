# Development Log — Real BaNCS Data Integration

The running record of this initiative: the **active plan** (with live status), and an
**iteration log** of every change made and every error hit along the way.

Maintained under the protocol in [CLAUDE.md](CLAUDE.md#iteration-logging-protocol-mandatory) —
updated at the end of every iteration, never retro-written.

---

## 1. Goal

Replace the synthetic 15-metric demo data with the real-format TCS BaNCS extracts in
[`Claude_Data/`](Claude_Data/), scoring them against the contracted Schedule 23 SLAs, so the
dashboard, governance pack, exceptions view and Phase 2 intelligence all run on that data.

**Acceptance oracle:** [`Claude_Data/SLA_Expected_Results.xlsx`](Claude_Data/SLA_Expected_Results.xlsx)
gives the expected outcome for every row and every month. The engine is done when it
reproduces it with **zero differences**, row-level and monthly.

---

## 2. What the data is (analysis, Iteration 0)

> The workbook's README tab says the extracts are **synthetic test data in the real extract
> format**: names, policies, user IDs and request IDs are fictitious. Extract date 24/09/2026,
> activity 01/01/2025 – 23/09/2026.

### 2.1 Files

`SLA_Expected_Results.xlsx` and `SLA_Expected_Results(2).xlsx` are byte-identical. Every
extract ships as both `.csv` and `.xlsx`.

| File | Rows | Layout | Feeds |
|---|---|---|---|
| `EBQ_Correspondence_Report_V0_24092026` | 10,000 | Header on row 1, no title row | 23B NUL, 23B UL Step 1 |
| `CANREVEXT_…1781224092026` (Cancellation Tracker) | 2,000 | Title row 1, header row 2 | 23C |
| `WITHDRAWALEXT_…1781524092026` (Withdrawal extract) | 514 | Title row 1, header row 2 | 23B UL Step 2 |
| `WRKFLWEXT_…1781324092026` (Workflow, **open**) | 231 | Title row 1, header row 2, Status = In Progress | 23A, 23B UL 2–3, 23C, 23E |
| `WRKFLWEXT_…1781424092026` (Workflow, **closed**) | 5,124 | Same 16 columns, Status = Closed | 23A, 23B UL 2–3, 23C, 23E |
| `SLA_Expected_Results.xlsx` | 10 tabs | README, Monthly summary, Mapping for 23B, per-SLA tabs, Links | Oracle and 23B mapping |

### 2.2 The SLAs (entirely different from the current 15 metrics)

| SLA | Target | Population | Rule |
|---|---|---|---|
| **23A** | 97% | Workflows `Issue Policy Immediately` / `Issue Policy at a Later Date` | Created before 15:00: closed the same business day. 15:00 or later: same or next business day. |
| **23B NUL** | 96% | EBQ rows whose Product + Transaction maps to `NUL` | Merged by the end of the next business day after receipt |
| **23B UL Step 1** | 98% | EBQ rows mapped `UL` | Merged the same business day (no time in EBQ, so no 3pm cut-off) |
| **23B UL Step 2** | 98% | WITHDRAWALEXT matched to `Workflow for Withdrawal Approval` on the same policy | Created Date vs last-status time, using the 3pm rule |
| **23B UL Step 3** | 98% | `Workflow for Unit Adjustment` | Created vs Close, using the 3pm rule |
| **23B UL overall** | 98% | Steps 1–3 combined | Met ÷ completed |
| **23C** | 96% | CANREVEXT for 360 Protect, Business, Income and Mortgage Protection, matched to `Approve Cancellation` | Under 48 hours from workflow Created to last status |
| **23E** | 98% | Workflow type starting `Manual Review`, description contains "EFT Payment Not Recognised" (case-insensitive) | Closed the same or next business day |

Shared rules:
- A clock that starts on a weekend or holiday starts on the next business day, counted as
  before 15:00.
- Irish public holidays are listed in the oracle README.
- REJECTED EBQ items are excluded.
- Open items are classed as `OPEN - PAST DEADLINE` or `OPEN - NOT YET DUE` against the extract date.
- Rate (Completed) = Met ÷ (Met + Missed), and **PASS/FAIL is judged on this rate**.
- Rate (incl. Open) also counts open-past-deadline items as not met.
- Reporting month:
  - EBQ items use the receipt (Start) month.
  - Workflow SLAs use the workflow Created month.
  - Withdrawals with no workflow use the last-status month.

### 2.3 Oracle totals (what the engine must reproduce)

| SLA | Met | Missed | Open past deadline | Rate (Completed) |
|---|---|---|---|---|
| 23A | 1145 | 32 | 29 | 97.28% PASS |
| 23B NUL | 4575 | 190 | 855 | 96.01% PASS |
| 23B UL Step 1 | 1962 | 52 | 418 | 97.42% |
| 23B UL Step 2 | 442 | 12 | 49 | 97.36% |
| 23B UL Step 3 | 371 | 9 | 20 | 97.63% |
| 23B UL overall | 2775 | 73 | 487 | 97.44% FAIL |
| 23C | 1437 | 66 | 0 | 95.61% FAIL |
| 23E | 549 | 13 | 28 | 97.69% FAIL |

Monthly figures cover **22 months, 2024-12 → 2026-09**. Dec-2024 has a single 23C item.
Sep-2026 is a partial month.

Row-level outcome categories:
- `MET`, `MISSED`
- `OPEN - PAST DEADLINE`, `OPEN - NOT YET DUE`
- `OUT OF SCOPE`, `EXCLUDED - REJECTED`
- `NO MATCHING WORKFLOW` (Step 2)

### 2.4 Traps the oracle plants on purpose

- **Mapping:**
  - duplicate rows
  - code `Ul` (lowercase) instead of `UL`
  - a trailing space (`Change Income Recipient Bank Account Details `)
  - the misspelling `Infletion`
  - The mapping joins on **Transaction (col B) + Product**, not on col C.
- **3pm boundary:** 14:59:xx vs exactly 15:00:00, closed next business day (missed vs met).
- **23C:**
  - 47h59m30s vs exactly 48h00m00s
  - the 48h reading vs calendar-date and 2-working-day readings (alternates shown in the tab)
  - policies with an earlier, withdrawn approval workflow: use the **latest one created before** the last-status time
- **23E:**
  - description casing varies
  - 15 decoys spelled `Recognized`
  - 10 decoys that are Unit Adjustment workflows
  - 15 created by the system on a Saturday
- **Step 2:**
  - 10 withdrawals with no workflow
  - 10 approval workflows with no withdrawal
  - 14 policies with two withdrawals
  - 50 `Awaiting Authorization`, which are not completions
- **Request ID** has lost its last two digits (Excel 15-digit limit). Never use it as a join key.
- WITHDRAWALEXT carries the literal string `nan` in `Approver Role already approved`.

### 2.5 Where the current code does not fit

> **Superseded (Iteration 1):** the demo code this table analyses is being removed rather than adapted — see §3. Kept for history.

| # | Gap | Where |
|---|---|---|
| G1 | **Metric model:** 15 synthetic value-vs-target metrics. The real SLAs are met/missed *rates* with open-item backlog. | [config/sla-metrics.json](config/sla-metrics.json), [server/slaEngine.js](server/slaEngine.js) |
| G2 | **Source model:** 5 synthetic source fingerprints (BaNCS, AWS Connect, Azure, tracker, email). The real set is 5 BaNCS extract types, and two of them (open/closed workflow) share identical columns. | [config/source-templates.json](config/source-templates.json), [server/classify.js](server/classify.js) |
| G3 | **Time lost on xlsx:** `cellText()` turns Date cells into `YYYY-MM-DD`, dropping time-of-day. That kills the 3pm and 48h rules. | [server/parse.js:28](server/parse.js#L28) |
| G4 | **No date-time parsing:** `toDate()` reads `dd/mm/yyyy` but drops the time, and has no Excel-serial or `nan` handling. | [server/adapters/util.js:43](server/adapters/util.js#L43) |
| G5 | **No business calendar:** nothing knows about weekends, Irish holidays, the 3pm cut-off, or next-business-day deadlines. | new |
| G6 | **Per-file adapters:** each adapter sees one file. 23B UL Step 2 and 23C need **cross-file joins** (withdrawal ↔ workflow, cancellation ↔ workflow), and the open/closed workflow files must be unioned. | [server/pipeline.js](server/pipeline.js), [server/adapters/](server/adapters/) |
| G7 | **One upload per month:** the pipeline assumes one upload per month. The real extracts are a **single multi-month snapshot** that must fan out into 22 monthly packs. `detectMonth` would also mis-flag every file as `month_mismatch`. | [server/pipeline.js](server/pipeline.js), [server/dataQuality.js](server/dataQuality.js) |
| G8 | **Classifier assumes distinct sources:** `classifyBatch` assumes at most one file per template. Two WRKFLWEXT files need a content discriminator (Status / Close Date / Pending Since Days). | [server/classify.js:105](server/classify.js#L105) |
| G9 | **Hard-coded assumptions:** the UI hard-codes "of 5 sources" and the five source badges. The assistant aliases, narrative and demand panel assume calls, complaints and escalations. | [src/views/Ingest.jsx:118](src/views/Ingest.jsx#L118), [src/views/Dashboard.jsx:77](src/views/Dashboard.jsx#L77), [src/lib/sources.js](src/lib/sources.js), [server/assistant.js:35](server/assistant.js#L35), [server/narrative.js](server/narrative.js), [server/intelligence.js:305](server/intelligence.js#L305) |
| G10 | **Rail sized for ~6 months:** the left rail was just rebuilt to never scroll. 22 months will not fit as-is. | [src/components/Rail.jsx](src/components/Rail.jsx) |

The following survive unchanged:
- RAG engine shape
- Store layout (one current pack per month)
- Breakdown and clustering machinery
- The fabrication guard

---

## 3. Active plan

Status key: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` dropped (with reason)

> **Revised 2026-09-24 (Iteration 1).** The user directed: *forget every piece of logic in the
> previous version — it was a demo built on made-up rules. Follow only the data in
> `Claude_Data/`. Keep the UI design.* The original eight-phase plan, which adapted the demo
> pipeline, is superseded. The backend is being rebuilt from the data, and the UI keeps its
> visual design with its content rewritten.

### Decisions (confirmed by the user)

| # | Decision | Outcome |
|---|---|---|
| D1 | Synthetic demo | **Removed entirely.** No demo profile. The old metrics, sources, adapters, classifier, seed data and generators all go. |
| D2 | Amber / RAG | **None.** The workbook defines only PASS/FAIL, judged on Rate (Completed). The UI shows PASS, FAIL or "no completed items". |
| D3 | Service credits | **Dropped.** The data does not define them. |
| D4 | Ambiguous readings | Follow the workbook's stated defaults (README "Defaults" 1–10). |
| D5 | `Claude_Data/` in git | **Commit it**, on the feature branch `feature/real-bancs-data`. **Never commit to `main`.** |
| D6 | Intelligence panel | **Data insights plus an AI summary.** Trends and miss drivers are computed from the data. The Bedrock narrative and Q&A may only phrase those computed figures, and the fabrication guard is kept. **No forecasts.** |
| D7 | Getting data in | **Upload screen plus auto-load.** Drop the extract set once and every monthly pack is built. On a cold start, `Claude_Data/` is loaded automatically. |

### Phase A — SLA engine from the data (Iteration 1)
- [x] A1 `config/sla-schedule.json`: the 8 SLA lines (23A, 23B NUL, 23B UL plus Steps 1–3, 23C, 23E), targets, 3 pm cut-off and Irish holidays, all copied from the workbook.
- [x] A2 `scripts/extract-mapping.js` → `config/mapping-23b.json`: a verbatim copy of *Mapping for 23B*, 83 rows with the quirks preserved.
- [x] A3 `server/engine/datetime.js`: timestamps as UTC wall-clock. Handles Date cells, Excel serials, `dd/mm/yyyy hh:mm:ss`, ISO and `nan`.
- [x] A4 `server/engine/calendar.js`: business days, clock start, same-day / next-day / 3 pm-rule deadlines.
- [x] A5 `server/engine/extracts.js`: reads csv/xlsx and identifies the extract type from its column headers. Keeps the spreadsheet row numbers.
- [x] A6 `server/engine/workflows.js`: unions the open and closed WRKFLWEXT files, does the "latest workflow created before the event" join, and derives the extract date from Created + Pending Since Days.
- [x] A7 `server/engine/rules.js`: 23A, 23B NUL / UL Step 1, Step 2, Step 3, 23C, 23E, each returning item-level outcomes.
- [x] A8 `server/engine/engine.js`: `evaluate()` produces items plus the monthly roll-up (Rate Completed, Rate incl. Open, PASS/FAIL).
- [x] A9 `scripts/verify-real.js` + `npm run verify:real`: **0 diffs** against every SLA tab and the Monthly summary, for both the csv and xlsx sets.
- [x] A10 `server/engine/calendar.test.js` + `npm test`: 8 boundary tests.

### Phase B — Backend swap (Iteration 2)
- [ ] B1 Store layout:
  - `data/extracts/`: the current extract set, with an index
  - `data/analyses/<month>.json`: one pack per month
  - `data/snapshot.json`: as-of date, sources and totals
- [ ] B2 Pipeline:
  - `importExtracts(files)`: read, identify and store the files (a same-kind file replaces the old one, except workflow, which allows open + closed)
  - `rebuild()`: evaluate and write every month's pack
- [ ] B3 Data-quality findings, derived only from the data:
  - open items past deadline (backlog)
  - withdrawals with no approval workflow, and approval workflows with no withdrawal
  - REJECTED EBQ exclusions
  - EBQ pairs not in the 23B mapping
  - mapping quirks normalised
  - policies with more than one candidate workflow
  - partial final month
  - Request-ID precision loss
  - `nan` literals
- [ ] B4 API:
  - `bootstrap`
  - `extracts` (list / upload / delete / rebuild)
  - `analysis/:month`
  - `items/:month` (filterable)
  - `intelligence`
  - `ask`
- [ ] B5 Cold start: when no packs exist, import `Claude_Data/` automatically. `SKIP_BOOTSTRAP_DATA=1` disables this.
- [ ] B6 Delete the demo code:
  - `server/adapters/`, `classify.js`, `parse.js`, `slaEngine.js`, `dataQuality.js`, `prepareDemo.js`
  - `config/sla-metrics.json`, `config/source-templates.json`
  - `scripts/seed.js`, `scenario.js`, `generators/`, `lib/`, `prepare-demo.js`
  - `data/seed/`, `data/holdback/`
  - the matching npm scripts

### Phase C — UI on the real data (Iteration 3), keeping the visual design
- [ ] C1 Routing:
  - a global **Extracts** screen, reached from the dashboard hero and the rail
  - per-month views: SLA position, Exceptions, Governance pack
- [ ] C2 Dashboard:
  - hero copy
  - stats: periods, rows processed, SLA fails, overdue open items
  - period cards: PASS/FAIL of the 5 headline SLAs, with a partial-month tag
- [ ] C3 Rail: period cards show fails. Foot shows the extract as-of date.
- [ ] C4 Extracts screen:
  - drop zone
  - checklist of the 4 extract kinds (workflow expects open + closed)
  - file rows showing kind, records, header row and the SLAs fed
  - rebuild button
- [ ] C5 SLA position table, per SLA:
  - target
  - met / missed / open overdue / open not yet due
  - Rate (Completed), Rate (incl. Open)
  - gap to target
  - PASS/FAIL

  The 23B UL steps are nested. The data-quality panel sits below.
- [ ] C6 Exceptions: failing SLAs, plus an item-level table of missed and overdue items, filterable by SLA.
- [ ] C7 Governance pack (print/PDF):
  - executive summary composed from the figures
  - SLA table
  - exceptions
  - data quality
  - evidence (extract files)

### Phase D — Intelligence on the real data (Iteration 4)
- [ ] D1 `server/intelligence.js` rewritten, with no forecasts:
  - per-SLA monthly trend (both rates vs target)
  - months passed and failed
  - latest full month vs partial month
  - where misses concentrate (assignee, product, workflow / transaction type)
  - backlog by SLA
- [ ] D2 Narrative and Q&A rewritten to phrase only those figures. Keep the Bedrock client, the disk cache, the rules fallback and the fabrication guard.
- [ ] D3 Panel UI: trend chart (target line, fail region), SLA record, drivers, backlog, narrative and ask box.

### Phase E — Finish (Iteration 5)
- [ ] E1 README rewritten for the real data.
- [ ] E2 `npm run build`, then a browser walk-through of the dashboard, extracts, month views, pack PDF and intelligence.
- [ ] E3 `npm run verify:real` and `npm test` still green.


---

## 4. Iteration log

Newest entry at the bottom. Each entry: goal · changes · errors (symptom → cause → fix) ·
verification · next.

### Iteration 0 — 2026-09-24 · Analysis and planning

**Goal:** understand the codebase and `Claude_Data/`, and produce an integration plan and tracking files.

**Changes**
- Added `DEV_LOG.md` (this file): analysis, plan, iteration log.
- Added `CLAUDE.md`: project guide and the mandatory iteration-logging protocol.
- No source code changed.

**Errors faced**

| # | Symptom | Cause | Fix / workaround |
|---|---|---|---|
| E0.1 | `node_modules` missing, so `exceljs` was unavailable | `npm install` has never been run in this checkout | Analysed the workbooks with a stdlib-only Python xlsx reader (in the session scratchpad, not the repo). **Run `npm install` at the start of Iteration 1.** |
| E0.2 | `ModuleNotFoundError: pandas` | Python 3.13 has no data libraries installed | Same stdlib reader (zipfile + ElementTree) |
| E0.3 | `UnicodeEncodeError: 'charmap' codec can't encode '→'` | The Windows console defaults to cp1252. The oracle README contains `→` and `–`. | Run Python with `PYTHONIOENCODING=utf-8` |
| E0.4 | Monthly-summary dump over 57 KB, unreadable | Every cell carries a long `COUNTIFS` formula | Print cached values only and strip formula text |
| E0.5 | ripgrep rejected the glob `{a,b,src/**/*.{js,jsx}}` | Nested brace alternation is not supported | Use a flat glob such as `*.{js,jsx}` plus a path |

**Findings that change the design** (detail in §2):
- The real SLAs are rate-based and cross-file.
- The extracts are a multi-month snapshot.
- xlsx time-of-day is currently discarded.
- Two workflow files share one schema.

**Verification:** read-only analysis. Oracle totals are recorded in §2.3 for later comparison.

**Next:** confirm decisions D1–D5, then start Iteration 1 (Phases 1–3).

### Iteration 1 — 2026-09-24 · SLA engine built from the data

**Goal:** implement the Schedule 23 rules exactly as `SLA_Expected_Results.xlsx` defines them, and prove it against the workbook, before any UI work.

**Direction change (from the user):**
- Discard all demo logic and follow only `Claude_Data/`. Keep the UI design.
- Decisions D1–D7 are confirmed (§3).
- Work happens on the branch `feature/real-bancs-data`. Nothing is committed to `main`.

The plan was rewritten (§3) and §2.5 marked superseded, because the demo pipeline is being replaced rather than adapted.

**Changes**
- `npm install` (first run in this checkout).
- New config:
  - `config/sla-schedule.json`: SLAs, targets, cut-off, holidays, rule parameters
  - `config/mapping-23b.json`: generated
- New engine `server/engine/`:
  - `datetime.js`
  - `calendar.js`
  - `extracts.js`
  - `workflows.js`
  - `outcome.js`
  - `rules.js`
  - `engine.js`
  - `calendar.test.js`
- New scripts:
  - `scripts/extract-mapping.js`
  - `scripts/verify-real.js`
- `package.json`: added `test`, `verify:real`, `mapping:extract`.
- The old demo code is untouched so far. It is removed in Iteration 2 (B6).

**Errors faced**

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| E1.1 | `extract-mapping.js`: `TypeError: Cannot read properties of undefined (reading 'trim')` | ExcelJS `row.values` is truncated after the last filled cell, so an empty *Dependency* column was `undefined` | Read the columns by index with `row.getCell(n)` |
| E1.2 | First verify run: 1,500 / 1,491 / 185 diffs on the 23B EBQ / 23C / 23E tabs | The harness compared informational columns (month, candidate workflow) on rows the oracle marks OUT OF SCOPE. The engine had no reason to produce them. The **Expected Result matched on every row.** | The harness compares only the scope verdict on OUT OF SCOPE rows |
| E1.3 | Monthly summary: every SLA read the wrong columns (a "vs Target" cell showed a Rate formula) | The group labels are merged over 6 columns and ExcelJS repeats the label on every merged cell. The last occurrence won. | Take the first occurrence of each label |
| E1.4 | Monthly summary: 190 diffs, "expected null" / NaN | **ExcelJS drops a formula's cached result when it is falsy** (`0` or `""`), leaving `{formula}` only | A formula cell without a result is read as 0 (counts) or blank (verdict) |
| E1.5 | `npm test` → `MODULE_NOT_FOUND` | `node --test server/engine/`: Node 24 treats a directory argument as a module path | Use the glob `node --test "server/**/*.test.js"` |

**Verification**
- `npm run verify:real` → **VERIFY PASSED**, for both the csv set and the xlsx set:
  - 23B EBQ (10,000 rows), 23A (1,207), 23B UL Step 2 (514), Step 3 (400), 23C (2,000), 23E (777): all 0 diffs
  - Monthly summary (22 months × 8 SLAs): 0 diffs
  - Run time: csv about 0.3 s, xlsx about 1 s
- Mutation check: setting `cutoffHour` to 14 and `maxHours` to 48.01 made the harness fail loudly. 23A showed 237 diffs, and exactly the five planted "48h00m00s" 23C cases flipped. The config was restored afterwards.
- `npm test` → 8/8 pass.
- The derived as-of date is 2026-09-24. All 231 open workflows agree on it.

**Next:** Iteration 2 (Phase B): swap the backend to the new engine, add the data-quality findings and API, auto-load on cold start, and delete the demo code.
