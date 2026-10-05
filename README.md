# AIB Life · SLA Governance — Schedule 23 on data sources

The data sources go in. Every policy in them is judged against the Schedule 23 service
levels (23A, 23B NUL, 23B UL, 23C, 23E), using the business-day rules defined in
`SLA_Expected_Results.xlsx`. The output is one governance pack per reporting month, plus an
intelligence view across the whole history.

The engine reproduces the expected-results workbook **exactly**: row by row and month by
month, from both the `.csv` and the `.xlsx` data sources (`npm run verify:real`).

## Visual application guide

Open [the interactive application guide](public/application-guide.html) in a browser, or
read [the printable PDF](public/application-guide.pdf). It covers architecture, data flow,
three user journeys, every screen, SLA rules, and the current AI and storage boundaries.
When the app is running, the HTML guide is available at `/application-guide.html`.

## Run it

For the narrated client walkthrough, open [the demo player](deliverables/client-demo-v2/index.html)
or share [the 1080p MP4](deliverables/client-demo-v2/AIB-Life-Application-Demo.mp4).
The updated 3:57 video includes offline narration, captions, native Windows cursor artwork,
guided zooms and original background music. It shows the current terminology, live Amazon
Nova responses and Governance pack export. The five
source files and all 22 monthly results were verified against the current application data.
Caption files, the narration, and production notes are alongside the video.
The earlier recording remains in `deliverables/client-demo/`; use the updated version for presentations.

```bash
npm install
npm run dev        # API on :5174, UI on :5173
```

Open **http://localhost:5173**. On first start the server loads the delivered data sources from
`Claude_Data/` and builds every monthly pack, so the dashboard is never empty. To run
everything from a single process instead:

```bash
npm run preview    # builds the UI and serves it from the API on :5174
```

| Command | What it does |
|---|---|
| `npm run data:load` | Import `Claude_Data/` and rebuild every pack. Stop the server first on Windows. |
| `npm run reset` | Clear the imported set, the packs and the narrative cache |
| `npm run verify:real` | Diff the engine against `SLA_Expected_Results.xlsx`. It must report 0 differences. |
| `npm test` | Unit tests: calendar boundaries, data source identification, narrative guards |
| `npm run mapping:extract` | Regenerate `config/mapping-23b.json` from the workbook |
| `npm run bedrock:check` | Diagnose Amazon Bedrock access for the narrative |

## The data — `Claude_Data/`

| File | Rows | Feeds |
|---|---|---|
| `EBQ_Correspondence_Report_V0_24092026` | 10,000 | 23B NUL, 23B UL Step 1 |
| `CANREVEXT_…` (Cancellation Tracker) | 2,000 | 23C |
| `WITHDRAWALEXT_…` (Withdrawal data source) | 514 | 23B UL Step 2 |
| `WRKFLWEXT_…13…` (Workflow data source, open policies) | 231 | 23A, 23B UL Steps 2–3, 23C, 23E |
| `WRKFLWEXT_…14…` (Workflow data source, closed policies) | 5,124 | 23A, 23B UL Steps 2–3, 23C, 23E |
| `SLA_Expected_Results.xlsx` | 10 tabs | Rules, targets, holidays, the 23B mapping, and the expected result for every row |

Each data source ships as both `.csv` and `.xlsx`. The workbook's README says the data is
synthetic but in the real data source format. The data sources are **one snapshot** covering
December 2024 to September 2026, taken on 24 September 2026.

## The service levels

| SLA | Target | Measured on | Met when |
|---|---|---|---|
| **23A** Policy issue | 97% | Workflows *Issue Policy Immediately / at a Later Date* | Closed the same business day (created before 15:00), or the same or next business day (15:00 or later) |
| **23B NUL** Non-unit-linked alterations | 96% | EBQ rows mapped NUL (Product + Transaction) | Merged by the end of the next business day after receipt |
| **23B UL** Unit-linked transactions | 98% | Steps 1–3 combined | — |
| ↳ Step 1 | 98% | EBQ rows mapped UL | Merged the same business day |
| ↳ Step 2 | 98% | Each withdrawal and its *Workflow for Withdrawal Approval* | Last status reached under the 3 pm rule |
| ↳ Step 3 | 98% | *Workflow for Unit Adjustment* | Closed under the 3 pm rule |
| **23C** Cancellations | 96% | Protection-product cancellations and their *Approve Cancellation* workflow | Under 48 hours |
| **23E** Unrecognised EFT payments | 98% | *Manual Review* workflows mentioning "EFT Payment Not Recognised" | Closed the same or next business day |

Rules that apply across the service levels, all taken from the workbook:
- Weekends and Irish public holidays are not business days.
- A clock that starts on either one starts on the next business day, counted as before 15:00.
- REJECTED EBQ policies are excluded.
- Open policies are overdue once their deadline day is before the data source date.

Each pack reports two rates:
- **Rate (completed)** = met ÷ (met + missed). This decides **pass or fail**.
- **Rate incl. open** also counts overdue open policies as not met.

Policies are reported in these months:
- EBQ policies: the month they were received.
- Workflow SLAs: the month the workflow was created.
- Withdrawals with no workflow: the month of their last status.

The workbook's traps are handled as it specifies:
- duplicated mapping rows, the code `Ul`, trailing spaces
- 14:59 vs 15:00
- 47h59m30s vs 48h00m00s
- superseded approval workflows (the latest one created before the event is used)
- the `Recognized` decoys
- Request IDs that have lost precision (never used as a key)

Definitions live in [`config/sla-schedule.json`](config/sla-schedule.json). The mapping is
in [`config/mapping-23b.json`](config/mapping-23b.json), a verbatim copy of the workbook tab.

## How it works

```
data sources ─▶ identify by columns ─▶ union open + closed workflows ─▶ data source date from content
         ─▶ rules per SLA (policy outcomes) ─▶ monthly roll-up ─▶ one pack per month ─▶ UI
```

- **Identified by content.** Each file is recognised from its column headers. Only the
  first worksheet is read, because exports are single-sheet. The expected-results
  workbook is rejected with a clear message.
- **One current file per slot.** A set has five slots: EBQ, CANREVEXT, WITHDRAWALEXT,
  workflow-open and workflow-closed. A newer file for a filled slot replaces the older one.
  Loading a data source as both `.csv` and `.xlsx` therefore never double-counts.
- **The data source date comes from the data.** It is an open workflow's Created Date plus its
  Pending Since Days, which gives 24 September 2026. All 231 open workflows agree.
- **Every figure is traceable.** The engine keeps an outcome for every policy: clock start,
  deadline, completion and source row. The UI drills from any SLA line down to the records
  behind it.
- **Rules calculate; nothing is modelled.** There are no forecasts, amber bands or service
  credits, because the data defines none of them.

The code is split like this:
- [`server/engine/`](server/engine/): the pure SLA engine (calendar, data sources, workflows, rules, roll-up)
- [`server/pipeline.js`](server/pipeline.js): data source set → packs
- [`server/quality.js`](server/quality.js): data-quality findings
- [`server/insights.js`](server/insights.js): failure concentration
- [`server/intelligence.js`](server/intelligence.js): history view

## Screens

Use **Reports** within a reporting month to switch between SLA Status, SLA exceptions and Governance pack.
Policies are counted per service record; the same policy can appear more than once.

- **Dashboard.** Every reporting period grouped by year, showing how many of the 5 service
  levels met target, the policies measured and the overdue open policies.
- **Data Sources.** Drop the data source files and see which slots are filled, the derived data source
  date, and findings about the set itself.
- **SLA Status** (per month). Met, missed, open overdue, both rates, gap to target and
  pass/fail, with the 23B UL steps nested. Selecting a line lists its policies. The view also
  shows where failures concentrate and the data-quality findings.
- **SLA exceptions** (per month). The service levels below target, and every failed policy
  (missed or open overdue) with the record it came from.
- **Governance pack** (per month). A print-ready document; *Export as PDF* uses the
  browser's PDF engine. Open it from the dashboard shortcut (latest complete month),
  the visible Governance pack button on a month's results, or the Reports menu.
  Select **Export as PDF**, then **Save as PDF** in the print window to download a
  report containing the summary, SLA results, exceptions, findings and source evidence.
- **Intelligence** (the panel on the right edge). Monthly trends against target, each
  service level's pass/fail record, where failures concentrate (handler, product,
  transaction type), the overdue backlog, an executive narrative, and *Ask about this
  report*.

## Data-quality findings

The findings are stated next to the figures rather than estimated over. They come from the
data itself:
- policies open past their deadline
- withdrawals with no approval workflow, and approval workflows with no withdrawal
- policies whose earlier approval workflow was superseded
- REJECTED exclusions
- EBQ pairs the mapping does not cover
- the mapping quirks that were normalised
- an incomplete final month
- Request-ID precision loss
- `nan` placeholders
- any data source that has not been supplied

## Narrative and Q&A — and the guards

The executive narrative and *Ask about this report* phrase figures that the engine has
already computed. They never compute figures themselves.

| Layer | When |
|---|---|
| **Bedrock** (`BEDROCK_MODEL_ID`, default Amazon Nova Pro) | When AWS credentials are available (env, profile or `~/.aws/credentials`) |
| **Rules** | Otherwise, or whenever the model's text fails a guard |

The executive narrative applies two guards. Report Q&A currently applies only the figure guard:
- **Figure guard:** every number in the text must appear in the model's input.
- **Claims guard:** no service level may be described as meeting or missing target the
  wrong way round, and a "fails most often" claim must name the right one.

The claims guard exists because a model once described 23C as failing at 96.97% against a
96% target: a real figure attached to the wrong claim. Narratives are cached on disk by a
hash of their report inputs, provider, model and region. Enabling AWS or changing the model
therefore does not reuse a summary from the previous configuration.

To connect Amazon Nova, use `.env.example` as a template for the local, gitignored `.env`.
The default configuration is `AWS_REGION=us-east-1` and
`BEDROCK_MODEL_ID=amazon.nova-pro-v1:0`. Supply credentials through an AWS profile or
the server-side `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment variables;
temporary credentials also require `AWS_SESSION_TOKEN`. Keep credentials out of browser
code and Git. Restart `npm run dev` after changing the configuration.

`npm run bedrock:check` invokes the configured model through the application's adapter
and exits nonzero when configuration or access fails. The Intelligence narrative and
answers identify their provider; a cached executive summary is explicitly marked cached.
Q&A calls the model for each question, with the existing guards and rules fallback retained.

## Development log

[`DEV_LOG.md`](DEV_LOG.md) records the plan, every iteration's changes, the errors hit and how
they were fixed. [`CLAUDE.md`](CLAUDE.md) holds the working rules and known pitfalls.
