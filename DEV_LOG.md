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

### Phase B — Backend swap (Iteration 2) — done
- [x] B1 Store layout:
  - `data/extracts/`: the current extract set, with an index
  - `data/analyses/<month>.json`: one pack per month
  - `data/snapshot.json`: as-of date, sources and totals
- [x] B2 Pipeline:
  - `importExtracts(files)`: read, identify and store the files (a same-kind file replaces the old one, except workflow, which allows open + closed)
  - `rebuild()`: evaluate and write every month's pack
- [x] B3 Data-quality findings, derived only from the data:
  - open items past deadline (backlog)
  - withdrawals with no approval workflow, and approval workflows with no withdrawal
  - REJECTED EBQ exclusions
  - EBQ pairs not in the 23B mapping
  - mapping quirks normalised
  - policies with more than one candidate workflow
  - partial final month
  - Request-ID precision loss
  - `nan` literals
- [x] B4 API:
  - `bootstrap`
  - `extracts` (list / upload / delete / rebuild)
  - `analysis/:month`
  - `items/:month` (filterable)
  - `intelligence`
  - `ask`
- [x] B5 Cold start: when no packs exist, import `Claude_Data/` automatically. `SKIP_BOOTSTRAP_DATA=1` disables this.
- [x] B6 Delete the demo code:
  - `server/adapters/`, `classify.js`, `parse.js`, `slaEngine.js`, `dataQuality.js`, `prepareDemo.js`
  - `config/sla-metrics.json`, `config/source-templates.json`
  - `scripts/seed.js`, `scenario.js`, `generators/`, `lib/`, `prepare-demo.js`
  - `data/seed/`, `data/holdback/`
  - the matching npm scripts

### Phase C — UI on the real data (Iteration 3), keeping the visual design — done
- [x] C0 Remove the old per-month ingest flow (confirm/correct classification, samples, held-back file) from the UI
- [x] C1 Routing:
  - a global **Extracts** screen, reached from the dashboard hero and the rail
  - per-month views: SLA position, Exceptions, Governance pack
- [x] C2 Dashboard:
  - hero copy
  - stats: periods, rows processed, SLA fails, overdue open items
  - period cards: PASS/FAIL of the 5 headline SLAs, with a partial-month tag
- [x] C3 Rail: period cards show fails. Foot shows the extract as-of date.
- [x] C4 Extracts screen:
  - drop zone
  - checklist of the 4 extract kinds (workflow expects open + closed)
  - file rows showing kind, records, header row and the SLAs fed
  - rebuild button
- [x] C5 SLA position table, per SLA:
  - target
  - met / missed / open overdue / open not yet due
  - Rate (Completed), Rate (incl. Open)
  - gap to target
  - PASS/FAIL

  The 23B UL steps are nested. The data-quality panel sits below.
- [x] C6 Exceptions: failing SLAs, plus an item-level table of missed and overdue items, filterable by SLA.
- [x] C7 Governance pack (print/PDF):
  - executive summary composed from the figures
  - SLA table
  - exceptions
  - data quality
  - evidence (extract files)

### Phase D — Intelligence on the real data (D1–D2 done in Iteration 2; D3 UI in Iteration 3)
- [x] D1 `server/intelligence.js` rewritten, with no forecasts:
  - per-SLA monthly trend (both rates vs target)
  - months passed and failed
  - latest full month vs partial month
  - where misses concentrate (assignee, product, workflow / transaction type)
  - backlog by SLA
- [x] D2 Narrative and Q&A rewritten to phrase only those figures. Keep the Bedrock client, the disk cache, the rules fallback and the fabrication guard.
- [x] D3 Panel UI: trend chart (target line, fail region), SLA record, drivers, backlog, narrative and ask box.

### Phase E — Finish (done in Iteration 3)
- [x] E1 README rewritten for the real data.
- [x] E2 `npm run build`, then a browser walk-through of the dashboard, extracts, month views, pack PDF and intelligence.
- [x] E3 `npm run verify:real` and `npm test` still green.

### Phase F — Before production (found in Iteration 4)
- [ ] F1 **Header-less EBQ.** The workbook's README says the real EBQ report has no header row; the synthetic copy has one added. Extract identification relies on headers, so add a header-less EBQ reader that works from column positions, or agree a header at export.
- [ ] F2 **Extend the holiday calendar.** `config/sla-schedule.json` holds exactly the workbook's list, 2025-01-01 → 2026-08-03. Add 2026-10-26, 2026-12-25, 2026-12-26 and 2027 before loading later extracts, or those days count as business days.
- [ ] F3 Optional: pin published packs, so a newer snapshot cannot silently change a month already reported.
- [ ] F4 Optional: show the workbook's alternative readings (23C as "2 working days", 23B NUL by name only).
- [x] F5 Presenter's briefing published: https://claude.ai/artifact/PrWoChV2v16Ez4eKeemUr2 (private).


---

### Phase G — Local visual documentation (Iteration 5)
- [x] G1 Inspect current UI, API, pipeline, rules, quality, storage and intelligence code.
- [x] G2 Create a standalone interactive architecture, data-flow, journey and feature guide.
- [x] G3 Export a PDF, verify browser interactions and responsive layout, and link the artifacts from README.

### Phase H — Narrated client demo (Iteration 6)
- [x] H1 Capture the application's main features and user journey against the current data.
- [x] H2 Verify identical source bytes and all 22 monthly results in the isolated recording copy.
- [x] H3 Produce the 3–4 minute 1080p video with voiceover, captions, zooms and original music.
- [x] H4 Package the MP4, subtitles, local player, narration and verification evidence.

### Phase I — Customer terminology (Iteration 7)
- [x] I1 Rename Extracts to Data Sources, SLA position to SLA Status, policy Items to Policies, and Actions to Reports.
- [x] I2 Remove vendor wording from the working demo, including saved findings and cached Intelligence text; keep numeric evidence and identifiers intact.
- [x] I3 Refresh the application guide HTML/PDF and README; verify screens, filters, report navigation and print output.
- [-] I4 Expand or rename 23A/23B/23C/23E: explicitly cancelled by the user. Keep the codes unchanged.
- [ ] I5 Deferred by the user: grounded LLM chat using findings and report context, useful reasoning, scope controls and supported predictions. Revisit the existing fallback behavior and model configuration when resumed; no chatbot redesign in Iteration 7.
- [x] I6 Refresh the video, narration and captions with current terminology (Iteration 10, `deliverables/client-demo-v2/`).
- [x] I7 Keep Governance pack visibly accessible from the dashboard and selected monthly results, and clarify Export as PDF → Save as PDF (Iteration 8).

### Phase J — Amazon Nova connection (Iteration 9)
- [x] J1 Configure AWS server-side in gitignored local settings; verify the supplied identity and Nova Pro invocation.
- [x] J2 Correct the Bedrock diagnostic to test the app's configured model and return a failure status when access fails.
- [x] J3 Separate narrative cache entries by provider/model/region so enabling AWS does not retain a rules-only summary.
- [x] J4 Restart the local app, verify fresh narrative and chat responses, scoped refusal, cache switching and credential isolation.
- [ ] J5 User follow-up: rotate the key shared in the conversation and replace it in the local configuration. No IAM permissions or keys were changed by this iteration.

### Phase K ? Refreshed client demo (Iteration 10)
- [x] K1 Capture current terminology, Reports, Governance pack shortcuts and live Nova on the current application data.
- [x] K2 Replace the polygon cursor with native Windows arrow/hand artwork and accurate hotspots.
- [x] K3 Render and verify the 3?4 minute video with offline narration, captions, guided zooms and original music.
- [x] K4 Package the updated video, chaptered player, PDF example and verification evidence; retain the previous recording.

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

### Iteration 2 — 2026-09-24 · Backend rebuilt on the extract set; demo code removed

**Goal:** Phase B. Serve everything from the new engine, derive data-quality findings from the data, rewrite intelligence / narrative / Q&A to use only computed figures, auto-load `Claude_Data/`, and delete the demo.

**Plan change:** Phase D's backend (D1–D2) moved into this iteration, because the old intelligence modules depended on the deleted demo engine. D3 (panel UI) joins the UI work in Iteration 3. Added C0 (strip the old per-month ingest UI).

**Changes**
- Engine:
  - `rules.js`: 23B returns the unmapped EBQ pairs. Step 2 and 23C record `candidateWorkflows`.
  - `engine.js`: returns `workflows`, `mappingRows` and `unmapped23B` for the findings.
  - The verify harness still reports 0 diffs.
- New:
  - `server/slots.js`: the 5 slots of an extract set. The workflow slot is open or closed, decided from the rows' Close Date.
  - `server/quality.js`: findings for the whole set and for each month.
  - `server/insights.js`: failure concentration.
  - `scripts/load-data.js` (`npm run data:load`).
  - `server/narrative.test.js`.
- Rewritten:
  - `server/store.js`: `data/extracts`, `data/analyses/<month>.json`, `data/snapshot.json`.
  - `server/pipeline.js`: `importExtracts`, where a newer file for the same slot supersedes the old one, so csv + xlsx of one extract cannot double-count. Also `rebuild` (one pack per month) and `loadBundled`.
  - `server/index.js`: the new API, with serialised writes and a cold-start auto-load.
  - `server/intelligence.js`: trends, pass/fail record, drivers, backlog. **No forecasts.**
  - `server/narrative.js`: new brief, rules text and prompt. It keeps the Bedrock client, cache and figure guard, and adds a **claims guard**.
  - `server/assistant.js`: resolves the 8 SLA lines.
  - `scripts/reset.js`.
- **Deleted** (demo):
  - `server/adapters/`, `classify.js`, `parse.js`, `slaEngine.js`, `dataQuality.js`, `prepareDemo.js`
  - `config/sla-metrics.json`, `config/source-templates.json`
  - `scripts/seed.js`, `scenario.js`, `generators/`, `lib/`, `prepare-demo.js`
  - `data/seed/`, `data/holdback/`
  - the npm scripts `seed` and `demo`
  - the dependencies `pdf-parse` and `pdfkit` (the data has no PDFs)
- Housekeeping:
  - `.gitignore`: all of `data/` is runtime state.
  - `.gitattributes`: dropped the seed rules.
  - `.env.example`: `SKIP_BOOTSTRAP_DEMO` → `SKIP_BOOTSTRAP_DATA`.
  - `render.yaml` comment updated.

**Errors faced**

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| E2.1 | Node regex edits to `.gitignore` / `.gitattributes` / `.env.example` silently changed nothing | The working copies have **CRLF** line endings (git autocrlf), so `\n`-anchored patterns never matched | Edited with the Edit/Write tools. The same trap applies to any `\n` regex on tracked files. |
| E2.2 | The Bedrock (Nova Pro) narrative said **23C failed** in Aug 2026 (it passed, 96.97% vs 96%) and that **23B NUL fails most often** (23C does, 12 vs 11 months) | The figure guard only checks that numbers exist in the input. A real figure attached to the wrong claim passes it. The per-SLA `status` fields were easy to misread. | The brief now spells out `metTarget` / `missedTarget` lists and `missedTargetInMostCompleteMonths`. New `contradictedClaims()` guard rejects text that inverts a pass/fail or names the wrong "most often" SLA, and falls back to the rules text. Regression test uses the verbatim bad output. |
| E2.3 | Drivers listed groups at 1.01× the SLA's failure rate as "concentrations" | Ranking by failures × lift rewarded big groups at average rates | Require at least 1.25× the SLA rate. Rank by excess failures over the SLA rate. |
| E2.4 | Month findings listed "open past deadline" for 23B UL **and** its steps (double count) | The filter tested `x.parts` on result rows, which do not carry `parts` | Look up the roll-up ids in the schedule |
| E2.5 | A new narrative test failed | The test was wrong: "23B UL passed step 1 but failed overall" splits into a genuine pass claim, and rejecting it is the conservative behaviour | Rewrote the case to test real ambiguity |

**Verification**
- `npm run verify:real` → 0 diffs (csv + xlsx).
- `npm test` → 12/12.
- `npm run data:load` → 22 packs (2024-12 → 2026-09) in about 0.7 s. The totals equal the workbook's Total row for all 8 lines.
- API checks against the live server:
  - `bootstrap`: 22 months, 5 slots, 8 SLAs
  - `analysis/2026-08`: all 8 lines equal the workbook's Aug-2026 row
  - `items`: filters by SLA and outcome
  - `extracts`: 5/5 slots present
  - `intelligence`: backlog 1,399, which equals the sum of the workbook's overdue totals
  - `ask`: SLA resolution works, and off-topic questions are refused
- The Bedrock narrative after the fixes states every pass/fail correctly (checked by hand against the packs).

**Next:** Iteration 3 (Phase C + D3): move the UI onto the new API while keeping the visual design.

### Iteration 3 — 2026-09-24 · UI on the real data (design kept), README, end-to-end checks

**Goal:** Phase C + D3 + E. Move every screen onto the new API while keeping the visual design, rewrite the README, and prove the whole flow in a browser.

**Plan change:** Phase E (finish) was folded into this iteration. Iterations 4–5 are no longer needed.

**Changes**
- `src/App.jsx`: new routing.
  - `#dashboard` and `#extracts` (a global screen, because one extract set feeds every month)
  - `#<month>/position|exceptions|pack`
  - `/intel`
- New views and components:
  - `src/views/Extracts.jsx` (replaces Ingest): drop zone, 5-slot checklist, file rows, reload / rebuild, set findings
  - `src/views/Position.jsx` (replaces Consolidated): SLA table with the 23B UL steps nested, click-through to items, drivers, findings
  - `src/components/ItemTable.jsx`
- Rewritten on the new data (same design classes):
  - `Dashboard.jsx`: grouped by year, pass/fail cards, partial-month tag
  - `Exceptions.jsx`: failing SLAs plus every failed item, with filters
  - `Pack.jsx`: the print document
  - `Intelligence.jsx`: trend, SLA record, drivers, backlog, narrative, ask
  - `Rail.jsx`: Extracts nav, pass/fail period cards
  - `TrendChart.jsx`: rates vs target, fail region, clipped outliers
  - `NarrativeCard.jsx`: verdict from data, new topic labels
  - `AskReport.jsx`, `Chips.jsx` (`Status`, `Outcome`)
  - `lib/format.js`, `lib/sources.js`, `api.js`
- Deleted: `src/views/Ingest.jsx`, `src/views/Consolidated.jsx`, `src/components/ConfidenceRing.jsx`.
- `src/styles.css`: one small block added (nested SLA rows, filter bar, item table, nowrap chips). The existing tokens and classes are reused throughout.
- Server:
  - `intelligence.js` returns `allMonths` for the scope picker
  - `narrative.js` includes the completed-item count on the worst month
  - `extracts.js` reads **only the first worksheet** and rejects the expected-results workbook
  - new `server/engine/extracts.test.js`
- `README.md` rewritten for Schedule 23 on the BaNCS extracts.

**Errors faced**

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| E3.1 | A scripted edit of `NarrativeCard.jsx` failed ("missing: const TOPICS") | Regex literals such as `\b` inside a JS template string passed through a bash heredoc no longer matched the file text | Used the Edit tool for regex-bearing code |
| E3.2 | 23C trend chart flattened into a line along the top | December 2024 holds 1 completed 23C item (0%), which stretched the axis to 0–100% | Values more than 40 pp below target are drawn clipped at the axis with their real value labelled. "Weakest month" now shows its completed-item count. |
| E3.3 | The Service level record showed the latest month's PASS next to the whole-window rate (e.g. 23C 95.61% "PASS") | Mixed semantics in one cell | That cell now shows the window status |
| E3.4 | Narrative highlighting boxed "23" in "23C" and "24" in "24 September 2026" | The figure regex had no letter or date awareness | Lookbehind/lookahead on alphanumerics, plus skip rules for day-of-month and "Step N" |
| E3.5 | Tables overflowed the card at 1440 px: status chips wrapped, the outcome column was clipped | Too many columns and long labels | SLA name moved to a sub-line. Chips no longer wrap. Clock start → deadline share one cell. "Taken" folded into Completed. Outcome chips use short labels with the workbook term as tooltip. |
| E3.6 | **`SLA_Expected_Results.xlsx` was accepted as a WITHDRAWALEXT** and replaced the real one (found by the upload test) | The reader searched every sheet, and the workbook's '23B UL Step 2' tab carries every WITHDRAWALEXT column | Read only the first worksheet (BaNCS exports are single-sheet). Reject the workbook by its tabs. Regression tests cover every extract in both formats and the workbook. |

Note (branch): `git reflog` shows `checkout: moving from feature/real-bancs-data to Ommkar` at 15:00:38, just after the Iteration 1 commit. It did not come from Claude's commands. The Iteration 2 and 3 commits therefore landed on **`Ommkar`**, which now holds the whole initiative. `feature/real-bancs-data` stops at Iteration 1. `main` is untouched at `fcb17ec`. The branches were left as they are.

Note: the "exit code 127" notices for background servers were the servers stopped deliberately for restarts. They are not failures.

**Verification**
- `npx vite build` passes. Headless Edge screenshots were reviewed for Dashboard, Extracts, SLA position, Exceptions, Governance pack and Intelligence (Aug 2026). The August figures match the workbook line for line.
- Upload scenario through the API:
  - uploading the xlsx twins of EBQ and both WRKFLWEXT files replaced the csv copies with **unchanged totals**
  - the workbook was rejected with a clear message
  - removing WITHDRAWALEXT turned Step 2 to NO_DATA and raised a red "not supplied" finding
  - "Reload delivered extracts" restored the set
- Cold start: after `npm run reset`, a fresh server auto-loaded `Claude_Data/` and built 22 periods.
- `npm test` → 24/24. `npm run verify:real` → 0 diffs.
- The Bedrock narrative passes both guards, and every pass/fail it states is correct.

**Next:** user review in the browser (`npm run dev`). Nothing is on `main`. Merging or opening a PR is the user's call.

### Iteration 4 — 2026-09-25 · Presenter's briefing

**Goal:** explain the whole project for a presentation: data flow, architecture, a demo script, findings and likely questions.

**Plan change:** added Phase F (§3). While preparing the briefing, two gaps surfaced that matter before any production use: the real EBQ report has no header row (F1), and the holiday calendar stops at 2026-08-03 (F2).

**Changes**
- No code, config or data changed.
- Published a private page, "Schedule 23 Governance Briefing": https://claude.ai/artifact/PrWoChV2v16Ez4eKeemUr2. It contains:
  - architecture and data-flow diagrams
  - four items traced end to end
  - the verification evidence and a demo script with fresh screenshots
  - findings, design decisions, likely questions and limits
- Updated the DEV_LOG.md plan (Phase F) and CLAUDE.md (status, pitfalls).

**Errors faced**

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| E4.1 | Artifact publish refused the screenshots: "blocked by a Read permission rule" | The supporting-file paths used the Windows 8.3 short form `C:\Users\OMMKAR~1\…`, which the scratchpad permission rule does not match | Republished with the long path `C:\Users\OmmkarBisoi\AppData\Local\Temp\…` and relative `files` under `root` |
| E4.2 | Correction to a chat summary from Iteration 3: it said the row-level check covered "16,898 rows" | Arithmetic slip | The six tabs hold 10,000 + 1,207 + 514 + 400 + 2,000 + 777 = **14,898** rows per format. The wrong total never reached a file; the briefing uses 14,898. |

**Verification**
- Every figure in the briefing was pulled from the live API or the packs:
  - worked examples: workflow 7116767 created 14:59:31; CANREVEXT rows 629 (48h00m00s) and 816 (47h59m30s); workflow 7117564; EBQ A900011160003
  - July 2025 is the only month where all five met target
  - 10 withdrawals with no workflow, 10 approval workflows with no withdrawal, 424 rejected
  - window rates incl. open, which match the workbook's Total row
- One headless render of the page was checked, then published.

**Next:** user review of the briefing. F1 and F2 are the first engineering tasks if this moves towards real extracts.

### Iteration 5 — 2026-09-29 · Local visual application guide

**Goal:** explain the current application's architecture, data flow, user journeys and features in an attractive, accessible artifact.

**Plan change:** added completed Phase G for a local, independently shareable guide based on current code.

**Changes**
- `public/application-guide.html`: self-contained responsive guide with eight selectable architecture components, a six-stage data flow, three selectable user journeys, six feature cards, SLA rules, intelligence boundaries and source references. Works offline without external assets or libraries; available at `/application-guide.html` through Vite or a fresh production build.
- `public/application-guide.pdf`: nine-page landscape PDF including every journey and expanded feature notes.
- `README.md`: linked both artifacts and corrected the guard description: narrative applies numeric and selected claims checks; Q&A currently applies only the numeric check.
- `CLAUDE.md`: updated current status and recorded the guard distinction.
- `DEV_LOG.md`: added Phase G and this entry. Application source, rules and stored data were not changed.

**Errors faced**

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| E5.1 | `Get-Command node,msedge` returned nonzero | Edge was not on PATH | Located the installed Edge executable by its full path. |
| E5.2 | Headless Edge GPU process failed in the sandbox | Browser rendering was restricted; registry/cache warnings also appeared | Reran the headless browser with approved escalation; screenshots and PDF generated. |
| E5.3 | Optional `Get-CimInstance Win32_Process` inspection returned access denied | Process inspection was restricted | Used generated artifacts and browser debugging results to verify completion; process inspection was unnecessary. |
| E5.4 | Inline Node validation command failed PowerShell parsing | Embedded regex quotes were interpreted by the shell | Moved validation into a temporary CommonJS file. |
| E5.5 | A repeated browser check could not connect to the debugging port | The reused profile retained an old DevToolsActivePort file | Used a fresh profile for each run; the final check passed. |

**Verification**
- Temporary `node tmp/verify-guide.cjs` browser check: inline JavaScript parses; local section anchors resolve; all eight architecture selectors and three journey switches work; no browser runtime exceptions.
- Headless Edge desktop at 1440 × 1100 and mobile at 390 × 844: no document horizontal overflow. Desktop full-page and mobile screenshots reviewed.
- Print check: all three journeys visible; PDF regenerated after print-layout adjustment, nine pages. Browser print hooks expand feature notes.
- `git diff --check`: passed, with normal repository LF/CRLF notices.
- Engine tests and oracle comparison were not rerun: this iteration adds documentation only. Historical engine verification is labelled as historical in the guide.

**Next:** open the HTML guide for interactive review or share the PDF. Existing Phase F engineering follow-ups remain open.

### Iteration 6 — 2026-10-01 · Narrated client application demo

**Goal:** deliver a professional 3–4 minute application walkthrough with voiceover, captions, guided zooms, interactions and music, using the same data currently loaded in the app.

**Plan change:** added completed Phase H. The user selected voiceover plus music and explicitly confirmed that the recording must use the current application data.

**Changes**
- `deliverables/client-demo/`: 3:57 MP4 (1920×1080, 24 fps, H.264/AAC stereo, about 46 MiB), local player with six chapter controls, SRT/WebVTT captions, narration text, poster, contact sheet, production notes, and validation reports. Screen imagery is captured from the actual app; camera moves and cursor cues are editorial overlays on interaction states.
- `scripts/demo/capture.mjs`: isolated API/UI recording setup, actual upload and rebuild, all main screens, filters, historical scope, report Q&A and print output. Uses copies of the current imported files. The original application's stored extracts and packs remain unchanged.
- `scripts/demo/verify-data.mjs`: SHA-256 source comparison plus all monthly results, items, findings and drivers. The initially captured bundled files were proven identical to the current source files; the capture script now takes the current imports directly for future runs.
- `scripts/demo/storyboard.json`, `voice.py`, `render.py`: reviewed narration, generated standard Sonia voice via edge-tts, timed captions, motion graphics, zoom/cursor edits and original synthesised instrumental music. Music is attenuated beneath speech.
- `scripts/demo/verify-video.py`, `check-player.mjs`: audio normalisation, full media decode, caption validation, encoded contact sheet, browser playback, chapter and mobile checks.
- `.gitignore`: excludes local production dependencies and intermediate media.
- `vite.config.js`: excludes media tooling/output from file watching to prevent Windows EBUSY crashes during recording and export; API proxy and app ports are unchanged.
- `README.md`, `CLAUDE.md`, `DEV_LOG.md`: links, current status, plan and operational lessons.

**Errors faced**

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| E6.1 | Initial isolated recording never reached the upload input | Vite's watcher encountered locked Edge profile files under the project and exited; the first temporary config also omitted the React plugin | Added the React plugin, moved browser profiles to OS temp and excluded production folders from the isolated watcher. |
| E6.2 | Initial caption preview lacked punctuation and had briefly overlapping intervals | Speech word metadata omits punctuation; adding end padding overlapped the next cue | Restored punctuation from the aligned narration tokens and clamped ends before following starts. |
| E6.3 | Initial zoom previews cropped the beginning of wide paragraphs | Full-width Intelligence prose was treated like a small interaction target | Limited those camera moves to preserve complete text and reviewed the updated frames. |
| E6.4 | Rapid chapter seeking produced uncaught playback promises | A seek/pause can interrupt a pending HTML media play request | Handled AbortError and provided a playback hint for other rejections; all chapter checks passed. |
| E6.5 | Original app's Vite process exited during media production | Its watcher also tried to watch temporarily locked generated files, including the verification JSON | Added production-folder exclusions in the main Vite config, then restarted and checked the app. |

**Verification**
- `node scripts/demo/verify-data.mjs`: five byte-identical input files; 22 monthly packs identical for results, item evidence, quality findings and drivers; zero differences. Current dataset: 17,869 source records, 12,254 measured items, as of 2026-09-24.
- Browser capture: 29 screenshots from real UI states, zero browser exceptions. Intelligence uses the built-in computed-figures narrative/Q&A; optional Bedrock is described accurately in narration and production notes.
- `python scripts/demo/verify-video.py --normalise`: full MP4 decode passed, 1080p/24 fps, 237.167 seconds of authored content, 83 non-overlapping caption cues, 23 frames extracted from the encoded video. Integrated loudness −15.98 LUFS; true peak −3.72 dBTP.
- `node scripts/demo/check-player.mjs`: local MP4 plays, six chapter buttons seek correctly, no mobile horizontal overflow, no browser runtime errors. Container duration 237.2 seconds.
- Reviewed the encoded contact sheet and desktop player screenshot. Narration, soundtrack and subtitle source assets are retained locally for edits.
- `git diff --check`: passed, with expected LF/CRLF notices. Application engine tests were not rerun; no SLA logic changed.

**Next:** user review of the video. The MP4 is ready to share; no video was sent to the client or uploaded externally.

### Iteration 7 — 2026-10-01 · Customer terminology in the working demo

**Goal:** use Data Sources, SLA Status, Policies and Reports in the customer experience; remove vendor wording. The user explicitly cancelled the proposed 23-code change and deferred the chatbot redesign.

**Plan change:** added Phase I, including the cancelled code expansion and deferred grounded-chat request. The existing recording must be refreshed before another client presentation; this iteration updates the live app and guide, not rendered video media.

**Changes**
- `src/App.jsx`: customer headings, as-of stamps and empty states; new public hashes `#data-sources` and `#YYYY-MM/status`, with existing hashes supported.
- `src/components/Rail.jsx`: Data Sources navigation, Reports menu with a document icon, vendor-free footer.
- `src/views/Dashboard.jsx`, `Extracts.jsx`, `Position.jsx`, `Exceptions.jsx`, `Pack.jsx`, `Intelligence.jsx`: labels, instructions, filters' surrounding copy, upload messages, record counts, evidence headings and print wording. Policy singular/plural forms are retained. Counts remain per service record, explained on Dashboard, SLA Status and the print pack.
- `src/components/Chips.jsx`, `ItemTable.jsx`, `NarrativeCard.jsx`: no-data and empty-state wording, verdict text and highlighting of policy counts.
- `src/lib/customerCopy.js`, `src/api.js`: presentation-only adaptation of known descriptive response fields, including legacy saved findings, cached narrative text, suggestions, answers and API errors. IDs, filenames, original record fields, outcomes, numbers and endpoint names are preserved. Backend scoring and chatbot behavior are unchanged.
- `public/application-guide.html`, `public/application-guide.pdf`, `README.md`: current names, Reports guidance, policy-count explanation and refreshed printable guide; README flags the older video's terminology.
- `CLAUDE.md`, `DEV_LOG.md`: current status, plan, deferred chatbot request, compatibility notes and verification lessons. Temporary checks and screenshots are under ignored `.demo-work/`.

**Errors faced**

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| E7.1 | First browser check raised a JavaScript syntax error | A newline in a generated evaluation string was not escaped | Used `String.fromCharCode(10)` in the temporary verification script. |
| E7.2 | Legacy-link check timed out waiting for URL canonicalisation | It changed an alias while already on the same React view; unchanged state does not rerun the hash-writing effect | Tested the old link from another screen and verified both rendering and the new public route. |
| E7.3 | Original data-integrity check could not find an imported CSV | The live set was re-imported during the session, replacing source IDs and changing two files to XLSX; this check did not perform imports | Preserved the current set, recorded the old-baseline differences, checked stability during the final run and compared all computed evidence against the earlier recording copy. No data was restored or overwritten. |
| E7.4 | README retained some old wording and an npm command was incorrectly renamed | The temporary prose replacement treated triple-backtick fences as inline code | Corrected code-span/fence handling, restored `mapping:extract`, and reviewed the command table and screen descriptions. |

**Verification**
- `npm run build`: passed after final application and guide changes.
- `npm test`: 24/24 passed.
- `node .demo-work/check-terminology.mjs`: 46 browser checks passed, including all 22 monthly SLA Status screens, Data Sources, legacy navigation, Reports menu, policy drill-down and filtering, exceptions, governance pack and print, cached Intelligence narrative and a rules answer. No browser runtime errors; no deprecated customer terminology in checked text or tooltips.
- Application-guide checks: all eight architecture selectors, all three journeys, desktop and 390 px layouts passed; PDF regenerated. Screenshots reviewed for Data Sources, Dashboard and Reports.
- Final verification run: 29 source/index/analysis/snapshot files unchanged during that run. All 22 months' results, summaries, findings, drivers and policy records match the earlier recording copy despite changed import metadata/formats. Source IDs and filenames are preserved by the display adapter.
- Both local ports answered successfully: UI `http://localhost:5173`, API `http://localhost:5174`.
- `git diff --check`: passed, with the repository's normal LF/CRLF notices. The full workbook oracle was not rerun because no calculation code changed.

**Next:** user review of the updated live demo. Keep the 23 codes unchanged. Resume the grounded LLM chatbot only when requested; refresh recorded media before sharing the revised demo with a client.

### Iteration 8 — 2026-10-01 · Governance pack access and PDF instructions

**Goal:** ensure the user can find and download the governance report to share findings.

**Plan change:** added completed I7. The pack and its PDF export were already implemented, but their location inside the Reports menu after selecting a month was easy to miss.

**Changes**
- `src/views/Dashboard.jsx`: visible Governance pack shortcut labelled with the latest complete reporting month; falls back to the newest period if none is complete.
- `src/App.jsx`: visible Governance pack button above SLA Status and Exceptions, opening the selected month's existing report.
- `src/views/Pack.jsx`: explains that Export as PDF opens the print window and Save as PDF downloads the report. All five report sections and the export handler remain intact.
- `README.md`: documents all entry points and the PDF save step.
- `CLAUDE.md`, `DEV_LOG.md`: current status, plan and the navigation lesson. No source data, computation, chatbot logic or report content was changed.

**Errors faced**

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| E8.1 | User believed Governance pack had been removed | The existing report entry was concealed in a menu that appears only after opening a reporting month | Added direct visible shortcuts and explicit PDF download guidance. |

**Verification**
- `npm run build`: passed.
- `node .demo-work/check-pack-access.mjs`: dashboard opens August 2026, the latest complete month; monthly Status and Exceptions shortcuts both preserve the selected July 2026 period; Reports still contains Governance pack.
- Browser export check: Export as PDF invokes the print handler. Print rendering hides navigation and save instructions; generated a valid 402,573-byte PDF. All five sections are present: executive summary, SLA Status, exceptions, data quality and source evidence.
- Screenshots reviewed at 1440 px and 1280 px; no document horizontal overflow at 1280 px. No browser runtime exceptions.
- UI/API proxy at `http://localhost:5173` returned HTTP 200 with 22 months. `git diff --check` passed, with normal LF/CRLF notices.
- No engine tests were rerun: the change adds navigation shortcuts and explanatory copy only.

**Next:** open any month's Governance pack, choose Export as PDF, then Save as PDF to share it. The deferred chatbot request and recorded-video refresh remain unchanged.

### Iteration 9 — 2026-10-01 · Connect the live application to Amazon Nova

**Goal:** use the supplied AWS credentials to connect the application to Amazon Nova automatically.

**Plan change:** added Phase J. This implements the requested connection; the broader grounded-chat redesign and forecasting request remain deferred.

**Changes**
- Local `.env` (gitignored, untracked): AWS credentials, `AWS_REGION=us-east-1` and `BEDROCK_MODEL_ID=amazon.nova-pro-v1:0`. Credential values were not added to tracked files or documentation. No IAM permissions or access keys were modified.
- `scripts/check-bedrock.js`: tests only the configured model through the same adapter used by the application, reports real success/failure, redacts credential values from error messages and uses a nonzero failure exit code.
- `server/narrative.js`: cache identity now includes the report brief, provider, model and region. Switching from rules to Bedrock cannot reuse the offline summary; credential values are excluded from cache identity.
- Restarted the confirmed local application's dev process tree, with the new runner hidden. Existing imported files and monthly packs were retained.
- `README.md`, `CLAUDE.md`, `DEV_LOG.md`: setup, cache behavior, current status and pending chatbot scope. Temporary verification scripts/results are in ignored `.demo-work/`.

**Errors faced**

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| E9.1 | Existing Bedrock diagnostic could not meaningfully test Nova | It hard-coded Anthropic clients/candidates despite the app supporting Nova through Converse | Reused the app's configured-model adapter in the diagnostic. |
| E9.2 | Existing cached summaries could obscure a newly enabled connection | Cache key previously covered report facts only | Added provider, model and region to cache identity and verified offline/online switching. |
| E9.3 | First diagnostic-file replacement patch was rejected | One patch attempted delete and add operations targeting the same path | Applied the replacement as separate sequential patch operations; the rejected patch changed no files. |

**Verification**
- AWS STS caller identity matched the supplied account and IAM user; a minimal Nova Pro request returned text. AWS's official Nova Pro documentation confirms the model ID and Bedrock Converse support: https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-pro.html.
- `npm run bedrock:check`: passed against `amazon.nova-pro-v1:0`, `us-east-1`.
- `node .demo-work/check-live-nova.mjs`: fresh executive summary returned `source: bedrock`, correct model, no fallback, about 2.97 seconds. The next request reused that model summary in 67 ms. A 23E question returned a live model answer in 1.75 seconds; an unrelated recipe request was declined in 1.27 seconds with `source: bedrock`.
- All 29 imported source/index/analysis/snapshot files were byte-identical before and after live API verification; only narrative cache entries were written.
- `node .demo-work/check-nova-cache-and-secrets.mjs`: offline configuration returns rules; re-enabling credentials returns the model summary, with no cache cross-over. `.env` is ignored and untracked. No supplied access-key or secret values were found in 83 scanned tracked files, built frontend files or server logs.
- `npm test`: 24/24 passed. `git diff --check`: passed with normal LF/CRLF notices. UI/API proxy returned HTTP 200 after restart. No frontend changes required a new build in this iteration.

**Next:** refresh Intelligence to use Nova. User should rotate the key shared in the conversation and update local settings. Resume the broader report-grounded chatbot redesign separately when requested.


### Iteration 10 ? 2026-10-01 ? Refresh the client demo and use a native cursor

**Goal:** deliver an updated professional 3?4 minute demo of the current application, using the same current data and a realistic Windows cursor, with narration, captions, zooms and music.

**Plan change:** completed I6 and added Phase K. The earlier recording remains intact. External TTS was rejected by automatic approval review, so narration was generated offline instead.

**Changes**
- `scripts/demo/storyboard.json`: rewrote the 23-scene narration and shot list for Data Sources, SLA Status, Policies, Reports, live Amazon Nova Pro, Governance pack shortcuts and Save as PDF. Schedule 23 codes remain unchanged; no deferred forecasting capability is claimed.
- `scripts/demo/capture.mjs`: fresh isolated run directories using the current five imported files, existing server-side Nova configuration, visible terminology/source assertions, scroll-before-click, complete SLA table capture, and a resumable final report sequence. No credentials enter media or capture metadata.
- `scripts/demo/native_cursor.py` and `render.py`: native Windows arrow/hand resources with alpha and true hotspots; eased motion and small click rings; current graphics/copy; separate v2 output; existing original music mix and 1080p encoding.
- `scripts/demo/voice.py` and `voice-local.ps1`: local Microsoft Zira Desktop speech, word-position timing alignment, WAV reuse and bundled FFmpeg conversion. No external narration transfer.
- `scripts/demo/verify-data.mjs`, `verify-video.py`, `check-player.mjs`: updated capture/output locations and run-specific data comparison. Final encoded-media and player results are recorded below when complete.
- `deliverables/client-demo-v2/`: new video, chaptered player, SRT/WebVTT captions, narration, poster, storyboard/source, Nova/data proof and actual August 2026 PDF example. The former `client-demo/` remains unchanged.
- `vite.config.js`: ignore every `deliverables/` version during development file watching.
- `README.md`, `CLAUDE.md`, `DEV_LOG.md`: point to the new demo and record production status, reproduction details and Windows pitfalls.

**Errors faced**

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | Previous production notes could not be opened | Assumed `PRODUCTION-NOTES.md`; the actual artifact is `production-notes.txt` | Located and read the existing file |
| 2 | Native cursor probe had an opaque background | Pillow's CUR reader returned RGB and lost alpha | Wrapped the unchanged cursor DIB as ICO, preserving RGBA and hotspot coordinates |
| 3 | External narration command rejected before execution | Automatic approval review disallowed sending application-specific narration to the external Edge TTS service | Used approved offline Windows speech; no external narration was sent |
| 4 | Patch validation rejected a delete/add pair | Two operations targeted `voice.py` in one patch | Added the helper separately and replaced the voice script once |
| 5 | Local voice selection failed inside the sandbox | Speech voices could be listed but not selected in that process | Ran the offline synthesizer with approved local access |
| 6 | FFmpeg discovery failed in the approved voice process, first through the wrapper and then binary glob | The wrapper/bundled binary were not resolved there, though local checks could access them | Separated approved offline speech generation from local `--reuse-wav` packaging; added `--synthesize-only` support |
| 7 | Governance pack capture timed out | Intelligence's close button was outside the scrolled viewport, so the click missed | Scroll controls into view before clicking and wait for the panel to close |
| 8 | `rg` reported an invalid Windows path | A literal `src/styles*` argument was interpreted as a path | Searched the concrete `src/styles.css` path |
| 9 | Preview showed part of Intelligence over the pack shortcut | Captured before the 800ms closing transition finished | Added a full transition wait, recaptured the final screens and restarted the draft encode |
| 10 | Process lookup denied during the draft restart | WMI access was unavailable in the sandbox | Interrupted only the known render session through its existing execution handle |
| 11 | Finished-media check found negative/overlapping caption intervals | Default 22,050 Hz speech output did not match the word event timing clock | Generated explicit 16,000 Hz PCM, validated every word against WAV duration and every caption before encoding, then regenerated the video |

**Verification**
- `node scripts/demo/capture.mjs` initially failed at the final pack step; after the click fix it captured all 32 states without browser exceptions. `--finish` recaptured the corrected closing transition, full SLA table and report screens successfully.
- Both narrative scopes and the demonstrated Q&A identified `amazon.nova-pro-v1:0`; capture assertions passed and `nova-verification.json` records the labels.
- `node scripts/demo/verify-data.mjs`: five source files byte-identical; all 22 monthly results, policy records, quality findings and drivers identical; zero differences.
- Offline narration generation produced all 23 WAV clips; `python scripts/demo/voice.py --reuse-wav` successfully aligned and encoded every clip.
- `python scripts/demo/render.py --preview`: 237.08 seconds, 83 caption cues. Reviewed contact sheet, full narrative, complete SLA table and native cursor interaction frames; corrected the panel overlap before final encoding.
- Node syntax checks and Python compilation passed for changed production scripts. Terminology/JSON/source-evidence checks passed. Live app bootstrap still reports 22 months and 17,869 records as of 2026-09-24.
- The first final-media check decoded successfully but failed caption timing validation. After explicit 16 kHz speech generation, all word intervals and 82 caption intervals passed the added pre-encode checks and the video was regenerated.
- `python scripts/demo/verify-video.py --normalise`: passed full-file decoding, 1920?1080/24fps H.264/AAC stereo, 237.083 seconds, 48.90 MiB, 82 captions with zero overlaps, and 23 encoded review frames. Final loudness ?16.07 LUFS, true peak ?1.47 dBTP.
- `node scripts/demo/check-player.mjs`: passed playback, all six chapter seeks and mobile layout; 237.1-second browser duration, no video errors, no browser exceptions and no mobile overflow. Player and poster also returned HTTP 200 from the running dev server.
- Reviewed the final encoded storyboard, Nova answer frame and desktop player. The native cursor frame was also visually checked. Repeated data comparison after the final render still reported zero differences.

**Next:** use `deliverables/client-demo-v2/index.html` for playback or share its MP4. The broader chatbot redesign remains deferred.
