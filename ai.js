/* Embedded AI growth analyst.
 * The model never sees a copy of the database it can invent around: every number comes from a tool
 * that runs the same engine functions as the dashboard, against the data as it is right now
 * (including the team's edits). Writes are only ever proposed; a person confirms each one on a card.
 *
 * Two ways to run it:
 *  1. Built-in: when the deployment has a server-side Gemini key (api/chat.js), the analyst works for every
 *     visitor with no setup. The key never reaches the browser.
 *  2. Bring your own key: a visitor can instead add their own Google Gemini, Anthropic Claude or OpenAI key.
 *     It stays in this browser (localStorage) and is sent only to that provider's API.
 * With neither, the analyst stays hidden and the rest of the site works the same.
 */
(function () {
  'use strict';
  const E = window.GCEngine;
  let App; let root; const toolLimit = 32;
  const histories = {}; // per workspace: [{role, content}]
  const drafts = {};
  let busy = false; let ctl = null;

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const L = (x) => (x == null ? '–' : '₹' + (+(x / 100000).toFixed(2)) + 'L');

  // ---------- provider config (standalone) ----------
  const cfgKey = 'gc_ai_cfg_v1';
  const getCfg = () => { try { return JSON.parse(localStorage.getItem(cfgKey) || 'null') || {}; } catch (e) { return {}; } };
  const setCfg = (c) => { try { localStorage.setItem(cfgKey, JSON.stringify(c)); } catch (e) {} };
  const PROVIDERS = {
    gemini: { label: 'Google Gemini', model: 'gemini-2.5-flash', keyHelp: 'Free key from Google AI Studio (aistudio.google.com/apikey).' },
    anthropic: { label: 'Anthropic Claude', model: 'claude-sonnet-5-5', keyHelp: 'Key from console.anthropic.com.' },
    openai: { label: 'OpenAI', model: 'gpt-4.1-mini', keyHelp: 'Key from platform.openai.com/api-keys.' },
  };
  let hosted = null; // { available, model } from GET /api/chat
  const ownKey = () => { const c = getCfg(); return !!(c.provider && c.key && PROVIDERS[c.provider]); };
  function providerName() {
    const c = getCfg();
    if (ownKey()) return `${PROVIDERS[c.provider].label} · ${c.model || PROVIDERS[c.provider].model} (your key)`;
    if (hosted && hosted.available) return `Built-in · Gemini ${hosted.model || ''}`.trim();
    return null;
  }
  const enabled = () => !!providerName();

  // ---------- rules ----------
  const RULES = `You are the Growth Analyst embedded in the Sponsor Growth Center, the command center a student festival team uses to raise sponsorship CASH for a Delhi college festival (Challenge B of the RISA Growth APM assignment).

Ground rules
1. Answer only from this app's data: the context block below and the tools. Never use outside knowledge about these brands, people or the market; every brand, person and event here is synthetic.
2. Every number you state must come from a tool result or the context block. For anything you derive yourself (sums, differences, ratios, percentages, per-unit figures, projections) call the calculate tool and use its result. Do not do arithmetic in your head.
3. Label claims: FACT (read directly from the records), CALC (computed from records by a tool or calculate), ASSUMPTION (a plan figure, prior, rule or threshold). Keep evidence separate from interpretation.
4. If the data cannot answer, say so plainly in the first sentence, name what is missing (e.g. "the dataset has no invoices, so cash received is unknown"), and offer the closest thing it can answer. Never guess a number. If a question is ambiguous (which campaign, which date, cash vs in-kind), state the reading you chose.
5. Use the as-of date in the context unless the user names another date; tools take an optional as_of (YYYY-MM-DD) for comparisons. Later records must not be used for an earlier date.
6. Recommendations: say what to scale, change or stop, why (cite the numbers), and the expected effect, with the risk or what would change your mind.
7. Actions: when the user wants something done (a task, a status change, a stage update), call propose_task or propose_update. These only create a draft card; tell the user to review and confirm it on the card. Never say it is done until the user has confirmed it (confirmed actions appear in the conversation as [Confirmed: ...]). A task needs a named owner and a due date; if you cannot infer them from the data, ask.
8. Style: lead with the answer in one or two sentences, then short evidence bullets, then the recommendation or next step. Money in Indian style, ₹ in lakh (₹1.25L) and exact rupees when it matters. Usually under 220 words; use a small table only when comparing several items. No filler, no repetition of the question.

Glossary: "reached" = outreach, intro or inbound touch; "responded" = replied (not wrong contact) or submitted the interest form; "qualified" = latest qualification status; "proposal" = deal reached proposal_sent or later; "confirmed" = latest stage partner_confirmed (reported value, not bank receipt). Targets count confirmed partnerships including in-kind unless stated.

Strategy context (Task 1, these are ASSUMPTIONS, not data): Delhi, DU host college, April festival. Committed base ₹24.0L signed → ₹20.4L cash at 85% collection (+20% on last year's ₹20.0L confirmed cash, which is the CampusFest 2025 dataset); stretch ₹30L signed / ₹27L cash. Every 2025 cash win came from warm, creator or inbound routes; cold routes won 0 of 33. Five ranked bets plus a title anchor: 1 Talent-to-Stage Challenge, 2 April Comfort and Access Partner, 3 Campus Creator Studio, 4 College Culture Circuit, 5 Discovery Trail. Rejected: mass cold outreach, title-only dependence, barter, selling student data.`;

  function contextPack(App) {
    const sn = App.snap; const ws = App.ws;
    const o = E.overview(sn);
    const camps = E.campaignKpis(sn).map((c) => `- ${c.campaign_name} [${c.sponsor_campaign_id}, ${c.channel}, owner ${c.owner_name || '–'}, status ${c.status}]: attempts ${c.attempts}, brands reached ${c.brands_reached}, replies ${c.replies} (${c.reply_rate_pct ?? '–'}%, positive ${c.positive_reply_rate_pct ?? '–'}%), meetings held ${c.meetings_held}, qualified ${c.qualified_brands}, deals ${c.opportunities}, proposals ${c.proposals}, confirmed ${c.confirmed} = ₹${c.confirmed_value_inr} (cash ₹${c.confirmed_cash_value_inr}), win rate ${c.win_rate_closed_pct ?? '–'}%, open pipeline ₹${c.open_pipeline_inr}, budget ${c.budget_inr ?? 'not recorded'}, spend ${c.spend_inr ?? 'not recorded'}; call: ${c.verdict} (${c.verdict_reason})`).join('\n');
    const tv = E.tasksView(sn);
    let plan = '';
    if (ws.plan) {
      const ps = E.planStatus(sn);
      plan = `\nPLAN STATUS (simulated live plan): week ${ps.campaign_week} of ${ps.weeks_total}, T−${ps.t_minus_days}. Signed cash ₹${ps.actuals.signed_cash_inr} (${ps.actuals.signed_pct_of_base}% of ₹${ps.targets.base_signed_inr} base), received ₹${ps.actuals.received_inr}, contractually due so far ₹${ps.actuals.contractually_due_to_date_inr}, overdue ₹${ps.actuals.overdue_inr}. Last checkpoint: ${(ps.cash_path.filter((c) => c.passed).pop() || {}).label || 'none'} band ${(ps.cash_path.filter((c) => c.passed).pop() || {}).band || '–'}. Next: ${ps.next_checkpoint ? ps.next_checkpoint.label + ' signed floor ₹' + ps.next_checkpoint.signed_floor_inr : 'none'}.
Bets: ${ps.bets.map((b) => `${b.bet_id} ${b.name} (owner ${b.owner}): gate ${b.gate.state}: ${b.gate.reason}; signed ₹${b.signed_inr} of plan ₹${b.plan_signed_inr}; hours ${b.hours_logged}/${b.hours_planned}`).join(' | ')}`;
    }
    const changes = (ws.change_log || []).slice(-6).map((c) => `${c.at ? c.at.slice(0, 16) : ''} ${c.text}`).join('; ');
    return `CONTEXT (computed just now by the app; treat as tool output)
Workspace: ${ws.workspace.name} (${ws.workspace.kind === 'source' ? 'original assignment dataset' : 'SIMULATED plan workspace'}). ${ws.workspace.description}
As-of date: ${App.asOf} (end of day IST). Data window: ${ws.event.history_start} to ${App.bases[App.wsId].workspace.default_as_of}. Event starts ${ws.event.event_starts_at}.
Overview: ${JSON.stringify({ brands_in_pipeline: o.brands_in_pipeline, brands_reached: o.brands_reached, brands_responded: o.brands_responded, brands_positive: o.brands_positive, meetings_held_brands: o.brands_meeting_held, qualification: o.qualification, opportunities: o.opportunities, open: o.opportunities_open, reached_proposal: o.opportunities_reached_proposal, confirmed: o.confirmed, lost: o.lost, withdrawn: o.withdrawn, open_pipeline_inr: o.open_pipeline_inr, targets: o.targets, cash: o.cash })}
Campaigns:
${camps}${plan}
Tasks: ${JSON.stringify(tv.counts)}${tv.counts.overdue ? '; overdue: ' + tv.tasks.filter((t) => t.overdue).slice(0, 6).map((t) => `${t.task_id} "${t.title}" (${t.owner}, due ${t.due_date})`).join('; ') : ''}
Team / owners: ${App.ownersList().join(', ')}
Recent changes by the team: ${changes || 'none (data is as originally loaded)'}
Settings: ${JSON.stringify(ws.settings)}`;
  }

  // ---------- tools ----------
  function snapFor(asOf) {
    if (!asOf) return App.snap;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error('as_of must be YYYY-MM-DD');
    const min = App.ws.event.history_start.slice(0, 10); const max = App.bases[App.wsId].workspace.default_as_of;
    if (asOf < min || asOf > max) throw new Error(`as_of ${asOf} is outside this workspace's data window (${min} to ${max}).`);
    return E.snapshot(App.ws, asOf);
  }
  const cap = (obj) => { const s = JSON.stringify(obj); if (s.length <= 30000) return obj; return { truncated: true, note: 'Result too large; narrow the request.', preview: s.slice(0, 29000) }; };
  const AS_OF = { type: 'string', description: 'Optional date YYYY-MM-DD for a historical snapshot. Defaults to the current as-of date.' };
  const trace = [];

  const TOOLS = [
    { name: 'get_overview', description: 'Headline KPIs at a date: funnel counts, qualification mix, confirmed deals and value (cash vs in-kind), open and weighted pipeline, targets vs actuals and attainment, cash received if recorded.', inputSchema: { type: 'object', properties: { as_of: AS_OF } }, run: (i) => E.overview(snapFor(i.as_of)) },
    { name: 'get_campaigns', description: 'Full KPI table per acquisition campaign (attempts, reach, reply and positive rates, meetings, qualified brands, deals, proposals, confirmed count/value, win rate, avg deal, open pipeline, days to close, budget/spend if entered, plan pace, scale/keep/change/stop call with the rule that triggered it).', inputSchema: { type: 'object', properties: { as_of: AS_OF } }, run: (i) => E.campaignKpis(snapFor(i.as_of)) },
    { name: 'get_funnel', description: 'Stage-by-stage funnel with conversion from the previous stage, overall or grouped.', inputSchema: { type: 'object', properties: { group_by: { type: 'string', enum: ['none', 'campaign', 'channel', 'owner', 'industry', 'domain'] }, as_of: AS_OF } }, run: (i) => E.funnel(snapFor(i.as_of), i.group_by || 'none') },
    { name: 'list_deals', description: 'List deals (opportunities) with their latest stage, value, campaign, owner and days in stage. Filters combine.', inputSchema: { type: 'object', properties: { stage: { type: 'string', description: 'prospecting, contacted, proposal_sent, negotiating, partner_confirmed, lost, withdrawn, or "open"' }, campaign: { type: 'string', description: 'campaign id or part of its name' }, owner: { type: 'string' }, brand: { type: 'string' }, support_type: { type: 'string', enum: ['cash', 'in_kind'] }, bet_id: { type: 'string' }, stale_only: { type: 'boolean', description: 'only open deals idle at least the stale threshold' }, min_value_inr: { type: 'number' }, sort: { type: 'string', enum: ['value', 'age', 'created'] }, limit: { type: 'number' }, as_of: AS_OF } },
      run: (i) => { const sn = snapFor(i.as_of); const rows = E.listOpportunities(sn, { stage: i.stage, campaign: i.campaign, owner: i.owner, brand: i.brand, support_type: i.support_type, bet_id: i.bet_id, stale_days: i.stale_only ? sn.ws.settings.stale_days : undefined, min_value_inr: i.min_value_inr, sort: i.sort }); return { count: rows.length, total_value_inr: E.sum(rows, (r) => (r.stage === 'partner_confirmed' ? r.confirmed_value_inr : r.proposed_value_inr)), deals: rows.slice(0, i.limit || 40), truncated: rows.length > (i.limit || 40) }; } },
    { name: 'get_brand', description: 'Everything about one brand: contacts, qualification now and history, interaction timeline, deals with stage history, activations, linked tasks.', inputSchema: { type: 'object', properties: { brand: { type: 'string', description: 'brand name or id' }, as_of: AS_OF }, required: ['brand'] }, run: (i) => E.brandDetail(snapFor(i.as_of), i.brand) },
    { name: 'get_forecast', description: 'Projected confirmed count and value: confirmed + open deals × win probability (empirical by stage and originating campaign, idle deals discounted; priors if too few closed deals). Can exclude deals or override stage win rates for what-ifs.', inputSchema: { type: 'object', properties: { exclude: { type: 'array', items: { type: 'string' }, description: 'opportunity ids or brand names to treat as lost' }, stage_win_rate_overrides: { type: 'object', properties: { prospecting: { type: 'number' }, contacted: { type: 'number' }, proposal_sent: { type: 'number' }, negotiating: { type: 'number' } } }, as_of: AS_OF } }, run: (i) => E.forecast(snapFor(i.as_of), { exclude_opportunities: i.exclude, win_prob_overrides: i.stage_win_rate_overrides }) },
    { name: 'get_trend', description: 'Weekly cumulative series up to a date. Metrics: confirmed_count, confirmed_value_inr, confirmed_cash_value_inr, qualified_brands, replies, meetings_held, opportunities, open_pipeline_inr, proposals, received_inr, target_confirmed, target_qualified.', inputSchema: { type: 'object', properties: { metrics: { type: 'array', items: { type: 'string' } }, as_of: AS_OF } }, run: (i) => E.weeklySeries(App.ws, i.as_of || App.asOf, i.metrics && i.metrics.length ? i.metrics : ['confirmed_count', 'confirmed_value_inr', 'qualified_brands']) },
    { name: 'get_bottlenecks', description: 'Diagnosis list: largest funnel drop, positive responders not qualified, engaged brands awaiting review, brands met with no deal, idle open deals, flagged campaigns, open deals by owner.', inputSchema: { type: 'object', properties: { as_of: AS_OF } }, run: (i) => E.bottlenecks(snapFor(i.as_of)) },
    { name: 'get_plan_status', description: 'Delhi 2027 plan layer only: bets with gate state and economics (cash per rupee, per hour), cash-path checkpoints with bands, route plan vs actual, 24-property inventory, budget and hours. Returns available:false in the source dataset.', inputSchema: { type: 'object', properties: { section: { type: 'string', enum: ['all', 'bets', 'cash_path', 'routes', 'inventory', 'budget'] }, as_of: AS_OF } },
      run: (i) => { const ps = E.planStatus(snapFor(i.as_of)); if (!ps.available || !i.section || i.section === 'all') { if (ps.inventory) ps.inventory = { by_tier: ps.inventory.by_tier }; return ps; } const m = { bets: ['bets'], cash_path: ['cash_path', 'next_checkpoint', 'actuals', 'targets'], routes: ['routes'], inventory: ['inventory'], budget: ['budget', 'capacity'] }[i.section]; return Object.fromEntries(['campaign_week', 't_minus_days', ...m].map((k) => [k, ps[k]])); } },
    { name: 'run_scenario', description: 'Reforecast the Task 1 plan and the live pipeline: assume property tiers unsold (title, signature, category, competition, supporting), drop bets (TITLE, B1..B5), change the collection rate, or add deals. Delhi 2027 workspace only.', inputSchema: { type: 'object', properties: { exclude_tiers: { type: 'array', items: { type: 'string' } }, exclude_bets: { type: 'array', items: { type: 'string' } }, collection_rate: { type: 'number' }, add_deals: { type: 'array', items: { type: 'object', properties: { tier: { type: 'string' }, bet_id: { type: 'string' }, value_inr: { type: 'number' } } } } } }, run: (i) => E.scenario(App.snap, i) },
    { name: 'list_tasks', description: 'Tasks with owner, due date, status, priority, overdue flag and what they link to.', inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['todo', 'in_progress', 'blocked', 'done'] }, owner: { type: 'string' }, overdue_only: { type: 'boolean' } } }, run: (i) => E.tasksView(App.snap, i) },
    { name: 'query_records', description: 'Flexible read-only query for questions the other tools do not cover. Tables: brands, contacts, campaigns, interactions, qualification_latest, qualification_history, opportunities (latest state), opportunity_history, activations, targets, tasks, payments, bets, properties. Filters: [{field, op, value}] with op eq, neq, contains, in, gt, gte, lt, lte, is_null, not_null. Optional group_by (field or list) with aggregate count, count_distinct, sum, avg, min, max, median over field. Without aggregate returns rows (max 60) and the available field names.', inputSchema: { type: 'object', properties: { table: { type: 'string' }, filters: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, op: { type: 'string' }, value: { type: 'string' } } } }, group_by: { type: 'array', items: { type: 'string' } }, aggregate: { type: 'string' }, field: { type: 'string' }, fields: { type: 'array', items: { type: 'string' } }, limit: { type: 'number' }, as_of: AS_OF }, required: ['table'] }, run: (i) => E.query(snapFor(i.as_of), i) },
    { name: 'get_data_coverage', description: 'What the data contains and cannot answer, definitions, record counts, data-quality fixes, number of team edits applied. Use before saying something is not in the data.', inputSchema: { type: 'object', properties: {} }, run: () => E.dataCoverage(App.ws) },
    { name: 'calculate', description: 'Exact arithmetic. Supports + - * / ( ) ^ and % (e.g. "2000000*0.85", "(24-20)/20*100"). Use for every derived number.', inputSchema: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] }, run: (i) => E.calculate(i.expression) },
    { name: 'propose_task', description: 'Draft a task in the management tool. Creates a confirmation card only; nothing is saved until the user confirms.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, owner: { type: 'string', description: 'a person from the team / owners list' }, due_date: { type: 'string', description: 'YYYY-MM-DD' }, priority: { type: 'string', enum: ['high', 'medium', 'low'] }, linked_type: { type: 'string', enum: ['campaign', 'opportunity', 'brand', 'bet', 'payment', 'none'] }, linked_id: { type: 'string' }, linked_label: { type: 'string' }, notes: { type: 'string', description: 'why, with the supporting numbers' } }, required: ['title', 'owner', 'due_date', 'notes'] },
      run: (i) => draft('task_create', { title: i.title, owner: i.owner, due_date: i.due_date, priority: i.priority || 'medium', status: 'todo', linked_type: i.linked_type === 'none' ? null : i.linked_type || null, linked_id: i.linked_id || null, linked_label: i.linked_label || null, notes: i.notes || null }, `Create task: ${i.title}`) },
    { name: 'propose_update', description: 'Draft a change to existing data for the user to confirm: task_status (target_id = task id, value todo/in_progress/blocked/done), campaign_status (campaign id, value active/paused/stopped), campaign_budget (campaign id, value in INR), deal_stage (opportunity id, value a stage), deal_value (opportunity id, value INR), bet_signal (bet id, value "signal_name=value").', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['task_status', 'campaign_status', 'campaign_budget', 'deal_stage', 'deal_value', 'bet_signal'] }, target_id: { type: 'string' }, value: { type: 'string' }, reason: { type: 'string' } }, required: ['kind', 'target_id', 'value', 'reason'] }, run: (i) => proposeUpdate(i) },
  ];

  function proposeUpdate(i) {
    const ws = App.ws; const v = i.value;
    switch (i.kind) {
      case 'task_status': { const t = ws.tasks.find((x) => x.task_id === i.target_id); if (!t) throw new Error('No task ' + i.target_id); return draft('task_update', { task_id: t.task_id, fields: { status: v } }, `Move task "${t.title}" from ${t.status} to ${v}`, i.reason); }
      case 'campaign_status': { const c = ws.campaigns.find((x) => x.sponsor_campaign_id === i.target_id || x.campaign_name === i.target_id); if (!c) throw new Error('No campaign ' + i.target_id); return draft('campaign_update', { sponsor_campaign_id: c.sponsor_campaign_id, fields: { status: v } }, `Set ${c.campaign_name} to ${v}`, i.reason); }
      case 'campaign_budget': { const c = ws.campaigns.find((x) => x.sponsor_campaign_id === i.target_id || x.campaign_name === i.target_id); if (!c) throw new Error('No campaign ' + i.target_id); return draft('campaign_update', { sponsor_campaign_id: c.sponsor_campaign_id, fields: { budget_inr: Number(v) } }, `Set ${c.campaign_name} budget to ${L(Number(v))}`, i.reason); }
      case 'deal_stage': case 'deal_value': {
        const o = App.snap.opps.find((x) => x.opportunity_id === i.target_id || (x.brand_name || '').toLowerCase() === String(i.target_id).toLowerCase()); if (!o) throw new Error('No deal ' + i.target_id);
        const payload = i.kind === 'deal_stage' ? { opportunity_id: o.opportunity_id, stage: v } : { opportunity_id: o.opportunity_id, stage: o.stage || 'prospecting', proposed_value_inr: Number(v) };
        if (i.kind === 'deal_stage' && !E.STAGES.includes(v)) throw new Error('Stage must be one of ' + E.STAGES.join(', '));
        return draft('opp_stage', payload, i.kind === 'deal_stage' ? `Move ${o.brand_name} deal from ${o.stage} to ${v}` : `Set ${o.brand_name} deal value to ${L(Number(v))}`, i.reason);
      }
      case 'bet_signal': { if (!ws.plan) throw new Error('No plan layer in this workspace'); const [k, raw] = String(v).split('='); let val = raw; if (raw === 'true') val = true; else if (raw === 'false') val = false; else if (raw !== '' && !isNaN(Number(raw))) val = Number(raw); const payload = k === 'fulfil_quote_inr' || k === 'hours_logged' ? { bet_id: i.target_id, [k]: val } : { bet_id: i.target_id, signals: { [k]: val } }; return draft('bet_update', payload, `Set ${i.target_id} ${k} = ${raw}`, i.reason); }
      default: throw new Error('Unknown kind');
    }
  }

  let pendingCards = [];
  function draft(type, payload, title, reason) {
    // validate now so the user is never shown a card that cannot be saved
    const id = 'D' + Math.random().toString(36).slice(2, 8);
    const test = E.materialize(App.bases[App.wsId], [...window.GCStore.get(App.wsId), { id: 'probe', at: new Date().toISOString(), effective_at: App.asOf + 'T20:00:00', type, payload }]);
    const last = test.change_log[test.change_log.length - 1]; if (last && last.error) throw new Error('This change would fail: ' + last.error);
    if (type === 'task_create') {
      if (!payload.owner) throw new Error('A task needs a named owner. Ask the user who should own it.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.due_date || '')) throw new Error('due_date must be YYYY-MM-DD');
      const known = App.ownersList().map((x) => x.toLowerCase());
      if (!known.includes(payload.owner.toLowerCase())) payload._owner_warning = `"${payload.owner}" is not in the team list`;
    }
    drafts[id] = { id, type, payload, title, reason: reason || payload.notes || '', status: 'pending', ws: App.wsId };
    pendingCards.push(id);
    return { status: 'draft_awaiting_user_confirmation', draft_id: id, summary: title, note: 'Tell the user to review and confirm the card. It is not saved yet.' };
  }

  // ---------- providers ----------
  async function callModel(messages, onText) {
    const tools = TOOLS.slice(0, toolLimit).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, execute: async (input) => runTool(t, input) }));
    const c = getCfg();
    ctl = new AbortController();
    if (!ownKey()) {
      if (hosted && hosted.available) return geminiLoop(messages, tools, { url: 'api/chat', headers: {} }, onText);
      throw { code: 'no_provider' };
    }
    if (c.provider === 'anthropic') return anthropicLoop(messages, tools, c, onText);
    if (c.provider === 'gemini') return geminiLoop(messages, tools, { url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(c.model || PROVIDERS.gemini.model)}:generateContent`, headers: { 'x-goog-api-key': c.key } }, onText);
    if (c.provider === 'openai') return openaiLoop(messages, tools, c, onText);
    throw { code: 'no_provider', message: 'No AI provider is connected.' };
  }
  async function runTool(t, input) {
    const started = Date.now();
    try { const out = cap(t.run(input || {})); trace.push({ tool: t.name, input, ok: true, ms: Date.now() - started, preview: JSON.stringify(out).slice(0, 1200) }); renderTrace(); return out; }
    catch (err) { trace.push({ tool: t.name, input, ok: false, error: String(err.message || err) }); renderTrace(); throw new Error(String(err.message || err)); }
  }

  async function anthropicLoop(messages, tools, c, onText) {
    const sys = messages[0].content; let msgs = messages.slice(1).map((m) => ({ role: m.role, content: m.content }));
    // merge consecutive same-role turns
    msgs = msgs.reduce((a, m) => { if (a.length && a[a.length - 1].role === m.role) a[a.length - 1].content += '\n\n' + m.content; else a.push(Object.assign({}, m)); return a; }, []);
    const apiTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
    let text = '';
    for (let round = 0; round < 8; round++) {
      const res = await apiFetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: c.model || PROVIDERS.anthropic.model, max_tokens: 4096, system: sys, messages: msgs, tools: apiTools }) });
      const j = await res.json();
      if (!res.ok) throw { code: 'upstream_error', message: (j.error && j.error.message) || res.statusText };
      if (j.stop_reason === 'refusal') throw { code: 'refused', message: 'The model declined this request.' };
      const blocks = j.content || [];
      const t = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (t) { text += (text ? '\n\n' : '') + t; onText(text); }
      if (j.stop_reason !== 'tool_use') return { text, truncated: j.stop_reason === 'max_tokens' };
      msgs.push({ role: 'assistant', content: blocks });
      const results = [];
      for (const b of blocks.filter((x) => x.type === 'tool_use')) {
        const tool = tools.find((x) => x.name === b.name);
        try { results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(await tool.execute(b.input)) }); }
        catch (err) { results.push({ type: 'tool_result', tool_use_id: b.id, content: String(err.message || err), is_error: true }); }
      }
      msgs.push({ role: 'user', content: results });
    }
    return { text: text || 'I could not finish within the tool budget. Please narrow the question.', truncated: true };
  }

  function geminiSchema(s) {
    if (!s || typeof s !== 'object') return s;
    const out = {}; for (const [k, v] of Object.entries(s)) { if (k === 'additionalProperties') continue; out[k] = k === 'properties' ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, geminiSchema(pv)])) : (k === 'items' ? geminiSchema(v) : v); }
    if (out.type === 'object' && out.properties && !Object.keys(out.properties).length) delete out.properties;
    return out;
  }
  async function geminiLoop(messages, tools, target, onText) {
    const sys = messages[0].content;
    const contents = messages.slice(1).map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const decl = tools.map((t) => { const d = { name: t.name, description: t.description }; const ps = geminiSchema(t.inputSchema); if (ps.properties) d.parameters = ps; return d; });
    let text = '';
    for (let round = 0; round < 8; round++) {
      const res = await apiFetch(target.url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, target.headers),
        body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents, tools: [{ functionDeclarations: decl }] }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw { code: res.status === 429 ? 'rate_limited' : 'upstream_error', message: (j.error && j.error.message) || res.statusText };
      const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
      const t = parts.filter((p) => p.text).map((p) => p.text).join('');
      if (t) { text += (text ? '\n\n' : '') + t; onText(text); }
      const calls = parts.filter((p) => p.functionCall);
      if (!calls.length) return { text: text || '(no answer)', truncated: false };
      contents.push({ role: 'model', parts });
      const resp = [];
      for (const p of calls) { const tool = tools.find((x) => x.name === p.functionCall.name); let out; try { out = await tool.execute(p.functionCall.args || {}); } catch (err) { out = { error: String(err.message || err) }; } resp.push({ functionResponse: { name: p.functionCall.name, response: { result: out } } }); }
      contents.push({ role: 'user', parts: resp });
    }
    return { text: text || 'I could not finish within the tool budget.', truncated: true };
  }

  // ---------- markdown (safe subset) ----------
  function md(src) {
    const lines = String(src || '').split('\n'); let html = ''; let list = null; let i = 0;
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
    const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        closeList(); const row = (x) => x.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const head = row(l); i += 2; let body = '';
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { body += '<tr>' + row(lines[i]).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>'; i++; }
        html += `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`; continue;
      }
      let m;
      if ((m = l.match(/^#{1,4}\s+(.*)/))) { closeList(); html += `<h4>${inline(m[1])}</h4>`; }
      else if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
      else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
      else if (!l.trim()) closeList();
      else { closeList(); html += `<p>${inline(l)}</p>`; }
      i++;
    }
    closeList(); return html;
  }

  // ---------- UI ----------
  // fetch with the Stop button wired in, and a plain-language error when the network or CORS fails
  async function apiFetch(url, init) {
    try { return await fetch(url, Object.assign({ signal: ctl && ctl.signal }, init)); }
    catch (err) { if (err && err.name === 'AbortError') throw { code: 'cancelled' }; throw { code: 'network', message: 'Could not reach the AI provider. Check your connection and key.' }; }
  }

  async function openaiLoop(messages, tools, c, onText) {
    const msgs = [{ role: 'system', content: messages[0].content }, ...messages.slice(1).map((m) => ({ role: m.role, content: m.content }))];
    const apiTools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema || { type: 'object', properties: {} } } }));
    let text = '';
    for (let round = 0; round < 8; round++) {
      const res = await apiFetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + c.key },
        body: JSON.stringify({ model: c.model || PROVIDERS.openai.model, messages: msgs, tools: apiTools }) });
      const j = await res.json();
      if (!res.ok) throw { code: 'upstream_error', message: (j.error && j.error.message) || res.statusText };
      const ch = (j.choices || [])[0] || {}; const m = ch.message || {};
      if (m.content) { text += (text ? '\n\n' : '') + m.content; onText(text); }
      const calls = m.tool_calls || [];
      if (!calls.length) return { text, truncated: ch.finish_reason === 'length' };
      msgs.push({ role: 'assistant', content: m.content || null, tool_calls: calls });
      for (const call of calls) {
        const tool = tools.find((x) => x.name === call.function.name);
        let out;
        try { if (!tool) throw new Error('Unknown tool ' + call.function.name); out = JSON.stringify(await tool.execute(JSON.parse(call.function.arguments || '{}'))); }
        catch (err) { out = 'Error: ' + String(err.message || err); }
        msgs.push({ role: 'tool', tool_call_id: call.id, content: out });
      }
    }
    return { text: text || 'I could not finish within the tool budget. Please narrow the question.', truncated: true };
  }

  const SUGGEST = {
    cf25: ['Which campaigns should we scale and which should we stop? Show the numbers.', 'Why did we miss the confirmed partnerships target?', 'How much cash have we actually received?', 'What did the pipeline look like on 1 March, and what would you have forecast?', 'Create a task to close out the idle cold-route deals.'],
    dl27: ['Why is cash behind plan this week?', 'Which bet should get more hours?', 'Reforecast if the title sponsor does not sign.', 'The Comfort Partner quote came in high. What should we do?', 'Did last year\'s sponsors see a sales lift?'],
  };
  const hist = () => (histories[App.wsId] = histories[App.wsId] || []);

  function shell() {
    const prov = providerName();
    root.innerHTML = `
      <div class="chat-head"><div class="row"><h2 style="font-size:1.02rem">Growth analyst</h2><div style="display:flex;gap:4px"><button class="btn sm ghost" data-ai="clear" title="Start a new conversation">New chat</button><button class="btn sm ghost" data-action="ai-setup" title="Change or remove your AI key">Key</button></div></div>
        <div class="small muted" id="ai-status">${prov ? `Answers from live app data · ${esc(prov)}` : 'No AI key added'}</div></div>
      <div class="chat-log" id="chat-log" aria-live="polite"></div>
      <form class="chat-input" id="chat-form"><label class="sr-only" for="chat-text" hidden>Ask the analyst</label><textarea id="chat-text" rows="1" placeholder="Ask a question about this data"></textarea><button class="btn accent" id="chat-send">Ask</button></form>`;
    renderLog();
  }
  function renderLog() {
    const log = root.querySelector('#chat-log'); if (!log) return;
    const h = hist();
    let html = '';
    if (!h.length) {
      html += `<div class="msg ai"><div class="body"><p>I answer from the data in <b>${esc(App.ws.workspace.name)}</b> as of <b>${esc(App.asOf)}</b>, including edits your team has made. I show which numbers are facts, calculations or assumptions, say when the data cannot answer, and draft tasks or changes for you to confirm.</p></div></div>
        <div class="chips">${SUGGEST[App.wsId].map((s) => `<button class="chip" data-ai="ask" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
    }
    for (const m of h) {
      if (m.role === 'user' && m.hidden) continue;
      if (m.role === 'user') html += `<div class="msg user">${esc(m.display || m.content)}</div>`;
      else html += `<div class="msg ai"><div class="body">${md(m.content)}</div>${m.truncated ? '<div class="small muted">The answer was cut short. Ask for less at a time.</div>' : ''}${(m.cards || []).map(cardHtml).join('')}${m.trace && m.trace.length ? traceHtml(m.trace) : ''}</div>`;
    }
    if (busy) html += `<div class="msg ai" id="live"><div class="body" id="live-text"></div><div id="live-cards"></div><div class="thinking" id="live-state">Reading the data…</div><div id="live-trace"></div><button class="btn sm" data-ai="stop">Stop</button></div>`;
    log.innerHTML = html;
    log.scrollTop = log.scrollHeight;
  }
  const traceHtml = (t) => `<details class="tools"><summary>Data used: ${t.map((x) => esc(x.tool)).join(', ')}</summary>${t.map((x) => `<pre>${esc(x.tool)}(${esc(JSON.stringify(x.input))}) ${x.ok ? '→ ' + esc(x.preview) : '✗ ' + esc(x.error)}</pre>`).join('')}</details>`;
  function renderTrace() { const el = root.querySelector('#live-trace'); const st = root.querySelector('#live-state'); if (st) st.textContent = 'Checked: ' + trace.map((x) => x.tool).join(', '); if (el) el.innerHTML = ''; const cards = root.querySelector('#live-cards'); if (cards) cards.innerHTML = pendingCards.map((id) => cardHtml(id)).join(''); }

  function cardHtml(id) {
    const d = drafts[id]; if (!d) return '';
    const p = d.payload;
    let body = '';
    if (d.type === 'task_create' && d.status === 'pending') {
      body = `<div class="form"><label class="wide">Task<input type="text" data-df="title" data-id="${id}" value="${esc(p.title)}"></label><label>Owner<input type="text" data-df="owner" data-id="${id}" value="${esc(p.owner)}"></label><label>Due<input type="date" data-df="due_date" data-id="${id}" value="${esc(p.due_date)}"></label><label>Priority<select data-df="priority" data-id="${id}">${['high', 'medium', 'low'].map((x) => `<option ${p.priority === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label>Linked<input type="text" data-df="linked_label" data-id="${id}" value="${esc(p.linked_label || '')}"></label></div>${p._owner_warning ? `<div class="small" style="color:var(--warn)">${esc(p._owner_warning)}</div>` : ''}${p.notes ? `<div class="small">Why: ${esc(p.notes)}</div>` : ''}`;
    } else body = `<div class="small">${esc(d.reason || '')}</div>`;
    const acts = d.status === 'pending' ? `<div style="display:flex;gap:6px"><button class="btn sm primary" data-ai="confirm" data-id="${id}">Confirm</button><button class="btn sm" data-ai="discard" data-id="${id}">Discard</button></div>`
      : d.status === 'done' ? `<div class="small"><b>Saved.</b> ${esc(d.result || '')} <a href="#tasks">Open tasks</a></div>` : '<div class="small">Discarded.</div>';
    return `<div class="action-card ${d.status === 'done' ? 'done' : d.status === 'discarded' ? 'discarded' : ''}"><div><span class="eyebrow">Draft for your approval</span><div><b>${esc(d.title)}</b></div></div>${body}${acts}</div>`;
  }
  // Setup form, shown in a drawer by the app. Optional: the dashboard works fully without it.
  function setupHtml() {
    const c = getCfg(); const cur = PROVIDERS[c.provider] ? c.provider : 'gemini';
    const builtIn = hosted && hosted.available;
    return `<h2>${builtIn ? 'AI analyst settings' : 'Add an AI analyst (optional)'}</h2>
      <p class="muted">${builtIn ? `The built-in analyst (Google Gemini) is ready with no setup.${ownKey() ? ' You are currently using your own key instead.' : ''} You can use your own key instead, for example for higher limits or a different model.` : 'The dashboard works without this. With your own API key, an analyst panel appears that answers questions from this data, runs the calculations, says when the data cannot answer, and drafts tasks for you to confirm.'}</p>
      <form class="form" data-submit="ai-cfg">
        <label class="wide">Provider<select name="provider">${Object.entries(PROVIDERS).map(([k, p]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
        <label class="wide">Model<input name="model" value="${esc(c.model || '')}" placeholder="Leave blank for the default: ${esc(PROVIDERS[cur].model)}"></label>
        <label class="wide">API key<input name="key" type="password" autocomplete="off" required value="${esc(c.key || '')}"></label>
        <p class="small muted wide">${Object.values(PROVIDERS).map((p) => `<b>${esc(p.label)}:</b> ${esc(p.keyHelp)}`).join('<br>')}</p>
        <p class="small muted wide">Your key is stored only in this browser and sent only to the provider you pick. Usage is billed to your account with that provider. Remove it here at any time.</p>
        <div class="wide" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary">${builtIn ? 'Use my key' : 'Save and open the analyst'}</button>${c.key ? `<button type="button" class="btn danger" data-action="ai-remove">${builtIn ? 'Remove my key and use the built-in analyst' : 'Remove my key'}</button>` : ''}</div>
      </form>`;
  }
  function saveCfg(fd) { const p = PROVIDERS[fd.provider] ? fd.provider : 'gemini'; setCfg({ provider: p, key: String(fd.key || '').trim(), model: String(fd.model || '').trim() }); histories[App.wsId] = histories[App.wsId] || []; shell(); }
  function removeCfg() { try { localStorage.removeItem(cfgKey); } catch (e) {} shell(); }

  async function ask(q, opts = {}) {
    if (busy || !q.trim()) return;
    if (!providerName()) { renderLog(); return; }
    busy = true; trace.length = 0; pendingCards = [];
    const h = hist();
    h.push({ role: 'user', content: q });
    renderLog();
    const messages = [{ role: 'user', content: RULES + '\n\n' + contextPack(App) + '\n\nThe conversation follows. Answer the latest user message.' }];
    for (const m of h.slice(-14)) messages.push({ role: m.role, content: m.content });
    let finalText = ''; let truncated = false;
    try {
      const r = await callModel(messages, (text) => { finalText = text; const el = root.querySelector('#live-text'); if (el) el.innerHTML = md(text); });
      finalText = r.text; truncated = r.truncated;
    } catch (e) {
      const code = e && e.code;
      const msg = { cancelled: 'Stopped.', network: e.message, no_provider: 'Add an API key to use the analyst.', rate_limited: (e.message || 'Too many requests.') + ' (Rate limit.)' }[code] || ('The AI provider returned an error: ' + ((e && e.message) || code || 'unknown') + '. Check the key and model under Key.');
      finalText = (e && e.text ? e.text + '\n\n' : '') + '_' + msg + '_';
    }
    h.push({ role: 'assistant', content: finalText || '(no answer)', truncated, cards: [...pendingCards], trace: trace.slice() });
    busy = false; pendingCards = [];
    renderLog();
  }

  async function confirmDraft(id) {
    const d = drafts[id]; if (!d || d.status !== 'pending') return;
    if (d.ws !== App.wsId) { App.toast('Switch back to the workspace this draft was made in.'); return; }
    const payload = Object.assign({}, d.payload); delete payload._owner_warning;
    const r = await App.edit(d.type, payload, { source: 'ai', toast: 'Confirmed and saved' });
    if (!r.ok) return;
    d.status = 'done';
    const created = d.type === 'task_create' ? App.ws.tasks[App.ws.tasks.length - 1] : null;
    d.result = created ? `Task ${created.task_id} · ${created.owner} · due ${created.due_date}` : d.title;
    hist().push({ role: 'user', hidden: true, content: `[Confirmed: ${d.title}${created ? ' → saved as task ' + created.task_id + ', owner ' + created.owner + ', due ' + created.due_date : ''}]` });
    renderLog();
  }

  function onClick(ev) {
    const el = ev.target.closest('[data-ai]'); if (!el || !root.contains(el)) return;
    const a = el.dataset.ai;
    if (a === 'ask') ask(el.dataset.q);
    else if (a === 'clear') { histories[App.wsId] = []; renderLog(); }
    else if (a === 'stop') { if (ctl) ctl.abort(); }
    else if (a === 'confirm') confirmDraft(el.dataset.id);
    else if (a === 'discard') { const d = drafts[el.dataset.id]; if (d) { d.status = 'discarded'; hist().push({ role: 'user', hidden: true, content: `[Discarded draft: ${d.title}]` }); renderLog(); } }
  }

  // Ask the deployment whether a built-in analyst is configured (api/chat.js with a server-side key).
  async function detectHosted() {
    try {
      const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 6000);
      const r = await fetch('api/chat', { method: 'GET', signal: ac.signal, headers: { accept: 'application/json' } }); clearTimeout(tm);
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null;
      const j = await r.json(); return j && j.available ? { available: true, model: j.model || '' } : null;
    } catch (e) { return null; }
  }

  async function mount(el, app) {
    App = app; root = el;
    detectHosted().then((h) => { hosted = h; if (h) { shell(); App.onAiChange && App.onAiChange(); } });
    shell();
    root.addEventListener('click', onClick);
    root.addEventListener('input', (ev) => { const t = ev.target; if (t.dataset && t.dataset.df) { const d = drafts[t.dataset.id]; if (d) d.payload[t.dataset.df] = t.value; } if (t.id === 'chat-text') { t.style.height = 'auto'; t.style.height = Math.min(140, t.scrollHeight) + 'px'; } });
    root.addEventListener('change', (ev) => { const t = ev.target; if (t.dataset && t.dataset.df) { const d = drafts[t.dataset.id]; if (d) d.payload[t.dataset.df] = t.value; } });
    root.addEventListener('submit', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (ev.target.id === 'chat-form') { const t = root.querySelector('#chat-text'); const q = t.value; t.value = ''; t.style.height = ''; ask(q); }
    });
    root.addEventListener('keydown', (ev) => { if (ev.target.id === 'chat-text' && ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); root.querySelector('#chat-form').requestSubmit(); } });
    renderLog();
  }

  window.GCAI = { mount, ask, enabled, setupHtml, saveCfg, removeCfg, refresh: () => { if (!busy) renderLog(); }, onWorkspaceChange: () => { if (!busy) renderLog(); }, _tools: TOOLS, _rules: RULES, _context: () => contextPack(App), _md: md, _setApp: (a) => { App = a; } };
})();
