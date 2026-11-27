# Sponsor Growth Center: Task 2, Challenge B (Sponsorship growth, Delhi festival)

**Live demo:** https://sponsor-growth-center-three.vercel.app/ (deployed on Vercel from this repository).

A static website with one small serverless function: no sign-in and no build step. Your edits are saved in your browser, and **Data & settings → Reset** restores the original dataset exactly. The AI analyst works for every visitor with no setup (a built-in Google Gemini key held on the server). Visitors can use their own Google Gemini, Anthropic Claude or OpenAI key instead.

The Growth Center is the operating tool behind the Task 1 plan: commit to **₹20.4L pre-festival cash (₹24L signed × 85% collected)**, with a gated stretch to ₹27L. It does four things the assignment asks for, and a fifth for the bonus:

| Assignment ask | Where it lives in the app |
|---|---|
| **Measure**: funnel, campaign KPIs, targets vs actuals, conversion, budgets, projections | Overview (KPI tiles, brand→deal funnel, targets-vs-actuals by week), Campaigns (per-route KPIs, budget and spend, cost per deal), Deals (pipeline and forecast) |
| **Diagnose**: what works, bottlenecks, drivers | Funnel "largest drop", Needs attention list, per-campaign verdict with its reason, idle-deal detection, bet gates |
| **Support decisions**: scale / change / stop | Rule-based verdict on every campaign and bet, each showing its rule; scenario reforecast on Bets & cash |
| **Manage execution**: campaigns, tasks, owners, deadlines | Edit deal stages, log interactions, create and edit campaigns, budgets, owners, targets, tasks and payments. Every edit persists and the analytics recompute at once |
| **AI Growth Analyst** (brownie points) | Right-hand panel (a bottom sheet on phones), ready with no setup. It answers from live app data through 16 tools, labels each number FACT / CALC / ASSUMPTION, says when the data cannot answer, and drafts tasks or changes that are saved only when you press **Confirm** |

---

## 1. Two workspaces

| Workspace | What it is | Why it exists |
|---|---|---|
| **CampusFest 2025** (source) | The supplied `Sponsor Dataset.xlsx`, converted losslessly (all raw rows kept). Default "as of" date 20 Apr 2025. | The original dataset must stay available for chatbot testing. It is never modified: edits are stored separately and **Data & settings → Reset** restores it exactly. |
| **Delhi Fest 2027 · live plan (simulated)** | The Task 1 plan (routes, five bets plus title, 24-property inventory, ramp, payment terms, cash path) with a deterministic simulated first four weeks of execution (seed 2027, "today" = 26 Feb 2027, end of week 4, T−42). | Shows how the team would run the Task 1 plan week by week: gates, cash path and scenarios. **Every Delhi number is simulated** and labelled as such in the app. |

Switch with the **Workspace** selector. The **Data as of** date lets you go back in time: everything is recomputed from records up to the end of that day (IST).

---

## 2. Research and sources

The Delhi plan comes from the Task 1 content pack (`Three_Slide_Content_Pack.pdf`). Sources and how far each was confirmed:

| Claim used | Source status |
|---|---|
| 2024 DU fest budgets: Crossroads ₹75L (₹50L cash + ₹25L in kind), Hansraj ₹35L (30,000 crowd), Mecca ₹30L (25,000+), Tempest ₹24L (70% sponsorship), KMC ₹13L | HT piece (Vistory reprint); student-quoted, not audited |
| Mecca 2026: 38+ brands, ₹48L+ | Organiser self-report |
| SRCC Business Conclave 2026 and IIMA CHAOS'26 rate cards | Sponsor brochures (asking prices, not realised) |
| Hansraj 2026 artist dispute; Confluence'26 overcrowding | News reports (allegations) |
| Last year's funnel, deal sizes and route performance | Supplied dataset (FACT) |

Benchmarks are used only as sanity checks (yield per head). The commitment rests on the dataset: 20 of 54 cash opportunities won, ₹20.0L confirmed, average ₹1.00L, range ₹0.5–2.0L, and **every win came from warm, creator or inbound routes; cold routes won 0 of 33**.

---

## 3. Data sources and data quality

`scripts/convert_dataset.py` reads every sheet of the xlsx into `data/campusfest2025.json`: the raw rows plus the readme and field guide sheets. The engine then:

- **Removes import-retry duplicates by ID**: 3 interaction rows, 1 qualification row and 2 opportunity-history rows appear twice with identical IDs. Each is counted once.
- **Takes the latest version per entity** (qualification status, opportunity stage), using timestamps up to the as-of cutoff.
- **Never lets later records leak backwards**: an as-of snapshot ignores every record dated after the end of the chosen day (ISO string comparison in IST).
- **Keeps units separate**: brands (pipeline → reached → responded → meeting → qualified) and deals (opened → proposal → confirmed) are different units. The funnel shows no conversion rate across the boundary (it would read 188.9%, because one brand can have several deals).

What the data **cannot** answer (the analyst says so, and `get_data_coverage` lists it): cash actually received (there are no invoices or bank receipts), marketing spend or budgets in 2025, sponsor sales lift or ROI, and audience or footfall.

---

## 4. Calculations (detailed)

All derived numbers are computed in `engine.js` (pure functions, no UI). The figures below are checked by `tests/engine.test.mjs` against values computed independently with pandas.

### 4.1 Headline KPIs (CampusFest 2025, as of 20 Apr 2025)

| KPI | Definition | Value |
|---|---|---|
| Confirmed partnerships | Opportunities whose latest stage is `partner_confirmed` | **24** of a goal of 28 (85.7%); goal from the "Sponsor revised plan", effective 15 Mar (the launch plan was 20) |
| Confirmed value | Σ confirmed value | ₹22.4L = 20 cash deals (₹20.0L) + 4 in kind (₹2.4L) |
| Average cash deal | ₹20.0L ÷ 20 | ₹1.00L (range ₹0.5–2.0L) |
| Qualified brands | Brands whose latest qualification status is `qualified` | **60** of a goal of 55 (109.1%) |
| Cash collected | n/a | **Not recorded** (shown as a gap, not as zero) |

### 4.2 Attribution

- Touches are credited to the interaction's campaign.
- Qualification is credited to its recorded source campaign.
- Deals are credited to their originating campaign.

### 4.3 Campaign verdicts (CampusFest 2025)

Rules (thresholds editable in Data & settings):

- **Scale**: at least 3 wins and a win rate on closed deals of at least 60%.
- **Stop**: at least 30 attempts, 0 wins and a positive-reply rate below 20%.
- **Change**: positive replies but conversion lagging.
- **Watch**: fewer than 8 attempts.
- **Keep**: otherwise.

Result:

| Campaign | Verdict |
|---|---|
| Brand Discovery Email | Stop (224 attempts, 0 confirmed, 6.3% positive) |
| Past Conversation Revival | Stop (44 attempts, 0 confirmed, 18.2% positive) |
| Brand Leader LinkedIn | Change |
| Warm Partner Introductions | Scale |
| Partner Interest Form (inbound) | Scale |
| Creator Network Referrals | Scale |

### 4.4 Forecast of confirmed deals

```
projected = confirmed to date + Σ over open deals (value × p(stage, campaign, idle))
```

- **Stage win rate**: p(win | deal reached stage s) among closed deals. Each originating campaign's rate is shrunk toward the overall rate: `p = (wins + k·overall) / (closed_reached + k)`, with k = 3. This keeps a campaign with 2 closed deals from claiming 100%.
- **Small samples**: with fewer than 8 closed deals the engine uses stage priors instead (0.10 / 0.20 / 0.50 / 0.65; ASSUMPTION) and says so.
- **Idle rule**: no won deal ever sat more than *T* days without a stage change (T = 5 in the data). Open deals idle longer than T use the shrunk win rate of closed deals that also went idle (at 15 Mar: 4 idle closed deals, 0 won → p = 0.107).
- **After the event starts**, open deals add nothing.

**Backtest** (run the as-of date back to 15 Mar 2025, then compare with what happened):

| Method | Projected deals | Projected value | Actual (20 Apr) |
|---|---|---|---|
| Naive overall stage rates | 37.7 | n/a | 24 |
| Shrinkage + idle rule (shipped) | **28.1** | **₹24.4L** | **24 / ₹22.4L** |

The shipped method still overshoots by about 4 deals. The app labels it CALC with the caveat that probabilities ignore timing.

### 4.5 Delhi plan: route pace and gates

Each route is measured against the Task 1 ramp. By the end of week 4 the plan expects 25 of 62 conversations, 12 of 36 proposals and ₹4L of ₹24L signed (ASSUMPTION: the ramp shape).

```
pace(metric) = actual ÷ expected-by-now
```

- **Scale**: pace ≥ 1 on every metric.
- **Change**: the lowest pace is below 0.7.
- **Stop**: conversations below 0.5 from week 4.
- **Keep**: otherwise.

The inbound route also has the Task 1 gate: **≥ 8 enquiries by the end of week 4, else move 20 pod hours to warm asks.** The simulation has 6, so the verdict is Change and the action is shown.

Week 4 result: Warm = Scale, Inbound = Change (6 against a gate of 8), Evidence-led = Change, Local = Keep.

### 4.6 Bet gates (Task 1, Slide 3)

Each bet has typed signals (societies committed, qualified calls, the comfort quote and so on) that you can edit on Bets & cash, and the gate re-evaluates at once. Examples:

- **Comfort Partner (B2)**: Stop when the quote is above ₹0.8L. The simulated quote of ₹1.68L triggers Stop, with cash per ₹ of 1.8.
- **Culture Circuit (B4)**: Scale needs 3 societies. With 2 it shows Change; entering 3 flips it to On track (this is covered by the workflow test).

### 4.7 Cash path

Checkpoints are derived from the 60/30/10 payment terms (ASSUMPTION) with a 7-day payment lag:

| Checkpoint | Green | Amber | Red |
|---|---|---|---|
| Signed-value checkpoints (weeks 4, 5, 7) | at or above the floor | 85–100% of the floor | below 85% of the floor |
| Received cash, week 8 | ≥ ₹20.4L (94.4% of ₹21.6L due, which is the base case at 85% collection) | in between | < ₹18.0L (83.3% of due, the 75% downside) |

Week 4 in the simulation: ₹3.5L signed against a floor of ₹4.0L, so the band is **amber**.

### 4.8 Scenario reforecast (reproduces Task 1)

```
plan cash = Σ planned deal values (after exclusions) × collection rate
```

| Scenario | Task 1 | App |
|---|---|---|
| Base (₹24L signed × 85%) | ₹20.4L | ₹20.4L |
| Title unsold | ₹17.0L | ₹17.0L |
| Both signature packages unsold | ₹16.15L | ₹16.15L |
| 70% collection | ₹16.8L | ₹16.8L |
| Core only (15 deals) | ₹12.75L | ₹12.75L |

The scenario also reports the live pipeline projection (signed to date plus the weighted open pipeline), so plan and reality sit side by side.

---

## 5. Prioritisation framework

From Task 1:

- **Impact × Confidence × Ease** (each 1–5) ranks the bets: Talent-to-Stage 80, Comfort Partner 48, Creator Studio 36, Culture Circuit 27, Discovery Trail 8. The title is an anchor, not a ranked bet.
- **Two efficiency checks**: cash per ₹ of budget, and cash per team-hour.

The Growth Center keeps the framework live:

- Bets & cash lists the bets in their I×C×E rank order, with each bet's planned cash per ₹ and cash per hour beside the **validated** versions computed from signed deals, logged spend and logged hours.
- The analyst has the Task 1 ranking in its context, uses it when asked where to put hours, and must show the calculation.

**Needs attention** collects campaign and bet verdicts, cash-path bands, overdue invoices and tasks, idle deals and brands met without a deal, sorted by severity (stop, then change, then watch). Each item has a **Create task** button that pre-fills the owner and due date.

---

## 6. How it is built

```
data/*.json ──► materialize(base, edits) ──► snapshot(ws, asOf) ──► overview / funnel / campaignKpis / forecast / planStatus / scenario …
                     ▲                                                  ▲                                     │
     store.js: append-only edit log                       ai.js tools call the same functions                 ▼
     (localStorage, this browser)                                                                    app.js views (vanilla JS + inline SVG)
```

- **Event-sourced edits.** Each change (a deal stage, task, campaign budget, target, payment, bet signal or setting) is a typed edit. It is validated, then appended with an effective timestamp. The base data is never mutated, so Reset is lossless and the as-of view applies only the edits made by that date.
- **Persistence.** Edits are saved in the visitor's browser (`localStorage`, key `gc_edits_v1_<workspace>`). Each visitor has their own copy, starting from the original data. Undo removes one edit; Reset removes them all. Edits can be exported as JSON from Data & settings. If the browser blocks storage, the header says so and edits last until the page closes.
- **No framework, no build step.** Six files at the repository root: `index.html`, `styles.css`, `engine.js`, `store.js`, `ai.js`, `app.js`, plus `data/`. Charts are hand-built SVG with hover tooltips and legends. Light and dark themes. Responsive down to a 390px phone, with no horizontal scroll (tested).

---

## 7. AI Growth Analyst

**Grounding.** Each question is sent with:

- a rules block;
- a compact **context pack** (overview, campaign lines, plan status, open tasks, owners, recent edits, settings), rebuilt on every turn so changed data is always current;
- the conversation history.

The model then calls tools that run the same engine functions the screens use:

| Kind | Tools |
|---|---|
| Read | `get_overview`, `get_campaigns`, `get_funnel`, `list_deals`, `get_brand`, `get_forecast`, `get_trend`, `get_bottlenecks`, `get_plan_status`, `run_scenario`, `list_tasks`, `query_records` (generic filter / group / aggregate over any table), `get_data_coverage` |
| Arithmetic | `calculate`: every derived number must go through it, so no mental maths |
| Actions (propose only) | `propose_task`, `propose_update` (deal stage, campaign status, budget, owner, target, bet signal, payment) |

**Rules the model follows:**

- Cite the tool used. The answer shows a collapsible "Data used" list.
- Tag figures FACT / CALC / ASSUMPTION.
- Answer "the data cannot answer this" and say what would be needed, instead of guessing.
- Ask a clarifying question when the request is ambiguous.
- Keep the Task 1 strategy in view (for example, do not recommend cold outreach without new evidence).

**Insight to action, with confirmation.**

- `propose_*` validates the draft against the same rules as a manual edit, then renders a **draft card**. The user can edit the title, owner, due date and priority, then **Confirm** or **Dismiss**.
- Nothing is written before Confirm. Confirmed items are saved with `source: "ai"`.
- A hidden `[Confirmed: …]` note goes into the history, so follow-ups ("did it save?", "now assign it to Ishita") know what happened.

**Built-in analyst (no setup).** `api/chat.js` is a Vercel serverless function that forwards the analyst's requests to Google Gemini (`gemini-2.5-flash` by default) with the site owner's key, stored as the `GEMINI_API_KEY` environment variable. The key never reaches the browser. The function only forwards the conversation and tool declarations; the tools themselves run in the visitor's browser on the live data. It accepts calls only from the site's own pages, has a per-visitor rate limit (60 model calls per 10 minutes, about 15 questions), and fixes the model on the server.

**Bring your own key (optional).** Click **Key** in the analyst panel (or **Add AI analyst** on a host without the built-in key), pick a provider, paste a key and optionally a model:

| Provider | Default model | API called from the browser |
|---|---|---|
| Google Gemini | `gemini-2.5-flash` (free key from Google AI Studio) | `generativelanguage.googleapis.com` (function calling) |
| Anthropic Claude | `claude-sonnet-5-5` | `api.anthropic.com/v1/messages` (tool use) |
| OpenAI | `gpt-4.1-mini` | `api.openai.com/v1/chat/completions` (tool calls) |

Your own key is stored only in that browser's `localStorage`, sent only to the chosen provider (the workflow test checks this), and used instead of the built-in analyst until you remove it. If neither is available (for example on a static host without the function), the panel and every "ask" button stay hidden and the rest of the site works the same.

**Try these** (they are also suggestion chips):

- "Which campaigns should we stop, and why?"
- "If Warm Partner Introductions had won 2 more deals, what would the confirmed rate be?"
- "How much cash have we actually received?" (the correct answer is that the data cannot say)
- Edit a deal to Confirmed, then ask "how many are confirmed now?"
- Delhi: "Reforecast if the title sponsor does not sign." / "The Comfort Partner quote came in high. What should we do?" / "Create a task for the inbound gate miss."

---

## 8. Assumptions register

| # | Assumption | Where it is used | Editable? |
|---|---|---|---|
| A1 | Collection rate 85% (base), 75% (downside), 90% (stretch) | Cash path, scenarios | Yes (settings, scenario) |
| A2 | Payment terms 60/30/10, first payment 7 days after signing | Cash path | Plan data |
| A3 | Stage priors 0.10 / 0.20 / 0.50 / 0.65 when fewer than 8 deals have closed | Forecast (Delhi) | Yes |
| A4 | Shrinkage k = 3; idle prior 0.25 | Forecast | Yes |
| A5 | Verdict thresholds (§4.3) | Campaign verdicts | Yes |
| A6 | Ramp shape 25/62 conversations, 12/36 proposals, ₹4L/₹24L signed by week 4 | Route pace | Plan data |
| A7 | Bet owners, hours and I×C×E scores | Bets & cash | Bet signals editable |
| A8 | Delhi 2027 execution data (brands, interactions, deals, payments, quotes) | The whole Delhi workspace | Simulated, deterministic |
| A9 | "As of" means the end of the day in IST; edits made in the app take effect at 20:00 IST on the as-of date | Snapshots | n/a |
| A10 | Target counts include in-kind deals (as the dataset's targets do); the cash commitment counts cash only | KPIs | n/a |

---

## 9. Setup

**Deploy on Vercel (no build step).**
1. In Vercel, choose **Add New → Project** and import this GitHub repository.
2. Framework preset: **Other**. Leave the build command and output directory empty (the site is the repository root).
3. **Built-in analyst:** create a free Gemini API key at Google AI Studio (aistudio.google.com/apikey). In Vercel, open the project's **Settings → Environment Variables**, add `GEMINI_API_KEY` with that key (all environments), and redeploy. Optional: `GEMINI_MODEL` to change the model.
4. Deploy. Every push to `main` redeploys.

Other static hosts (Netlify, GitHub Pages, Cloudflare Pages) serve the dashboard the same way; without the function, visitors add their own key for the analyst.

**Run locally.** Serve the folder over HTTP (not `file://`, because the page fetches `data/*.json`):

```bash
python3 -m http.server 8000      # then open http://localhost:8000/
```

**AI analyst locally:** a plain HTTP server has no `api/chat`, so click **Add AI analyst** and paste a Gemini, Claude or OpenAI key (or run `vercel dev` with `GEMINI_API_KEY` set).

**Regenerating the data:** the original workbook is kept at `data/source/Sponsor Dataset.xlsx`. Run `python3 scripts/convert_dataset.py "data/source/Sponsor Dataset.xlsx"` and `python3 scripts/simulate_delhi2027.py` (requires pandas and openpyxl).

**Tests** (Node 18+ and Playwright; `npm i -g playwright && npx playwright install chromium` if you do not have them). They are not part of the deployment:

| Command | What it checks |
|---|---|
| `node tests/engine.test.mjs` | 16 checks: KPIs, verdicts, as-of, backtest, scenarios, gates |
| `node tests/workflow.mjs` | 29 end-to-end checks in Chromium, with scripted stand-ins for the built-in analyst (Gemini format) and the OpenAI API that call the app's real tools (see below) |
| `node tests/api.test.mjs` | 9 checks on `api/chat.js`: key never exposed, fixed model, only allowed fields forwarded, other origins refused, rate limit |
| `node tests/smoke.mjs` | Every view in both workspaces with no console errors |

The workflow test covers:

- the site working with no AI on a host without the function (panel hidden, "Add AI analyst" offered) and no hosting-platform branding;
- the built-in analyst being ready with no key, and a visitor's own key (OpenAI) taking over when added;
- grounded answers with a calculation;
- a deal edit recomputing the KPIs, and the analyst seeing the change;
- "data cannot answer";
- a draft that is not saved before Confirm and is saved after it;
- the follow-up seeing the confirmation;
- the briefing leading the overview, Undo reversing an edit, and the guide closing;
- persistence across reload, including the key;
- as-of time travel;
- a bet gate flipping;
- reset;
- no horizontal scroll on a phone;
- the key being sent only to the chosen provider;
- no console errors.

---

## 10. Tools used

- Ideation, design direction and the end-to-end pipeline (research, strategy, data model, analytics, product and UX decisions, testing and deployment) were led, reviewed and approved by Anubhav.
- Claude Code was used as the build assistant: research synthesis, writing the code and tests, under Anubhav's direction.
- Vanilla JavaScript, HTML and CSS; inline SVG charts.
- Python (pandas, openpyxl) for data conversion and simulation.
- Playwright and Chromium for browser tests.
- Vercel for hosting and the serverless function; the browser's `localStorage` for persistence; Google Gemini (free tier) for the built-in analyst, or the visitor's own Gemini, Claude or OpenAI key.

---

## 11. Known limitations

- **Delhi 2027 data is simulated.** It shows how the tool runs the Task 1 plan; it is not evidence that the plan works.
- **No real cash data for 2025.** "Confirmed" values are not bank-verified, so collection rates are assumptions.
- **Small samples.** 21–33 closed deals; the per-campaign rates are shrunk but still noisy. The backtest overshoots by about 4 deals.
- **Model behaviour is not unit-tested.** The tests prove the plumbing (tools, confirmation, persistence) with a scripted stand-in model. Live answers depend on the provider and model chosen, and smaller models follow the rules less reliably.
- **The built-in analyst shares one free Gemini quota.** Google's free tier has daily and per-minute limits, so heavy use by many visitors can hit them; the panel then shows the limit message and suggests adding your own key. The per-visitor limit is held in memory, so it is best effort across server instances.
- **A visitor's own key lives in their browser** and calls go straight from the browser to the provider. That is fine for a demo, not for production. A provider can also refuse browser calls (CORS); the panel then shows the provider's error.
- **Edits are per browser.** There is no shared team database or sign-in, so two people see their own copies. Export the change log to share it.
- **Tool-call rounds are capped** at 8 per question. Very broad questions can end with a partial answer, which the panel flags.
- **The as-of date is a day, not a time.** Edits made in the app take effect at 20:00 IST on the chosen date.

---

## 12. Product and UX principles applied

The interface was reviewed view by view against four books, then changed. Each change is listed with the principle behind it.

Sources:
- *Don't Make Me Think, Revisited* (Krug): self-evident pages, scanning not reading, fewer words, clear conventions.
- *100 Things Every Designer Needs to Know About People* (Weinschenk): limited working memory, recognition over recall, progressive disclosure, people make mistakes, feedback.
- *The Lean Product Playbook* (Olsen): one metric that matters, the user's underserved need first, the UX iceberg.
- *Making Your Website Work* (McGovern): top tasks first, plain action-led words, every page earns its place.

| What changed | Principle | Book |
|---|---|---|
| The Overview opens with a **briefing**: a one-sentence answer to "are we on track?", one progress bar for the metric that matters (signed cash toward ₹24L, or confirmed partnerships toward the goal), the main drivers, and an **Ask the analyst why** button | Put the top task first; one metric that matters | McGovern; Olsen |
| **Do next** shows at most three actions, each with **Create task** | Limit choices so people decide; chunk to 3–4 items | Weinschenk |
| Headline numbers cut from 6 to 4 per workspace. Average deal and open pipeline moved into the lines under the numbers they explain | Working memory holds about four chunks | Weinschenk |
| "Needs attention" shows the three most urgent items with their reasons; the rest sit behind **Show N more** | Progressive disclosure | Weinschenk; Krug |
| The campaign table puts **Call and why** right after the name. By default it shows 8 key columns, with **Show all columns** for every metric. Before, the decision was off-screen to the right | Make the decision visible without scrolling; cut noise | Krug; McGovern |
| Headings name the job: "Campaigns: what to scale, change or stop", "Deals: move each one forward", "Bets & cash: are we on the path to ₹20.4L?", "Tasks: who does what, by when", "Where brands drop out" | Plain, action-led words; headings say what you get | McGovern; Krug |
| Plain-language labels. "Data as of (IST, end of day)" became **Show data as of** with an explanation on hover. Long banners became one sentence. The chat box says "Ask a question about this data". "Pipeline projection" became "Likely to sign" | Omit needless words; avoid jargon | Krug; McGovern |
| **Undo** in the confirmation message after every edit (the edit log makes it exact) | People make mistakes, so make errors cheap to reverse; give feedback for every action | Weinschenk |
| A **first-visit guide** with three things to try. It can be closed and reopened from **Guide** | Make the starting point obvious; orient in seconds | Krug |
| FACT / CALC / ASSUMPTION tags explain themselves on hover and in the guide | Recognition over recall | Weinschenk |
| **Ask** buttons and suggested questions send the question in one click | Reduce steps between intent and answer | Krug |
| Deal values show in lakh under each input. Red "days in stage" is explained in the page intro. Empty filters say how to recover | Clear feedback and helpful empty states | Weinschenk; Krug |
| **Reset** is disabled when there is nothing to reset, and its confirmation stays hidden until it is asked for | Prevent errors before they happen | Weinschenk |

Two bugs found and fixed during the review:
- The reset confirmation was always visible because a style overrode `hidden`.
- A task created in the app (for example one the analyst drafted) could not be edited, because validation checked the new edit without the earlier edits. This is now covered by the workflow test.
