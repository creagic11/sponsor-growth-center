/* Growth Center analytics engine.
 * Pure functions over a workspace dataset + an append-only edit log.
 * Used by the dashboard, the management tool and the AI analyst's tools, so every
 * number the UI shows and every number the chatbot quotes come from the same code.
 * Works in the browser (window.GCEngine) and in Node (module.exports) for tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GCEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- small helpers ----------
  const STAGES = ['prospecting', 'contacted', 'proposal_sent', 'negotiating', 'partner_confirmed', 'lost', 'withdrawn'];
  const OPEN_STAGES = ['prospecting', 'contacted', 'proposal_sent', 'negotiating'];
  const STAGE_RANK = { prospecting: 1, contacted: 2, proposal_sent: 3, negotiating: 4, partner_confirmed: 5 };
  const QUAL_STATUSES = ['unreviewed', 'engaged', 'qualified', 'unqualified', 'dormant'];
  const ROOT_EVENTS = ['outreach_sent', 'introduction_received', 'web_inbound'];
  const DAY = 86400000;

  const cutoffOf = (asOf) => asOf + 'T23:59:59';
  const dateOf = (ts) => (ts || '').slice(0, 10);
  const toMs = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const daysBetween = (a, b) => Math.round((toMs(dateOf(b)) - toMs(dateOf(a))) / DAY);
  const addDays = (d, n) => new Date(toMs(d) + n * DAY).toISOString().slice(0, 10);
  const round = (x, n = 1) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n);
  const pct = (num, den, n = 1) => (den ? round((100 * num) / den, n) : null);
  const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const uniq = (arr) => Array.from(new Set(arr));
  const groupBy = (arr, f) => arr.reduce((m, x) => { const k = f(x); (m[k] = m[k] || []).push(x); return m; }, {});
  const median = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const lakh = (inr) => round(inr / 100000, 2);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const latestBy = (rows, keyF, tsF, cutoff) => {
    const best = {};
    for (const r of rows) {
      const t = tsF(r);
      if (!t || t > cutoff) continue;
      const k = keyF(r);
      const cur = best[k];
      if (!cur || tsF(cur) < t || (tsF(cur) === t && String(cur.history_id || '') < String(r.history_id || ''))) best[k] = r;
    }
    return best;
  };

  // ---------- materialize: base dataset + edit log -> working dataset ----------
  function dedupe(rows, idField) {
    const seen = new Map(); let dropped = 0; let conflicts = 0;
    for (const r of rows) {
      const id = r[idField];
      if (id == null) { seen.set(Symbol('noid'), r); continue; }
      if (seen.has(id)) { dropped++; if (JSON.stringify(seen.get(id)) !== JSON.stringify(r)) conflicts++; continue; }
      seen.set(id, r);
    }
    return { rows: Array.from(seen.values()), dropped, conflicts };
  }

  function materialize(base, edits) {
    const ws = clone(base);
    const dq = {};
    for (const [t, id] of [['interactions', 'interaction_id'], ['qualification', 'history_id'], ['opp_history', 'history_id'], ['brands', 'brand_id'], ['contacts', 'contact_id'], ['opportunities', 'opportunity_id']]) {
      const r = dedupe(ws[t] || [], id); ws[t] = r.rows; dq[t] = { duplicates_removed: r.dropped, conflicting_duplicates: r.conflicts };
    }
    ws.tasks = ws.tasks || [];
    ws.payments = ws.payments || [];
    ws.settings = Object.assign(defaultSettings(ws), ws.settings || {});
    ws.campaigns.forEach((c) => { c.status = c.status || 'active'; });
    ws.change_log = [];
    const applied = [];
    for (const e of [...(edits || [])].sort((a, b) => (a.at || '').localeCompare(b.at || ''))) {
      try { applyEdit(ws, e); applied.push(e); ws.change_log.push(describeEdit(ws, e)); }
      catch (err) { ws.change_log.push({ id: e.id, at: e.at, type: e.type, error: String(err.message || err) }); }
    }
    ws.data_quality = dq;
    ws.edit_count = applied.length;
    return ws;
  }

  function defaultSettings(ws) {
    return {
      // ASSUMPTION priors used when there are too few closed deals to estimate stage win rates
      stage_win_prior: { prospecting: 0.1, contacted: 0.2, proposal_sent: 0.5, negotiating: 0.65 },
      min_closed_for_empirical: 8,
      collection_rate: 0.85,
      stale_days: 10,
      shrinkage_k: 3,
      verdict: { scale_min_wins: 3, scale_min_win_rate: 60, stop_min_attempts: 30, stop_max_positive_rate: 20, watch_min_attempts: 8 },
    };
  }

  let editSeq = 0;
  function newId(prefix) { editSeq++; return prefix + Date.now().toString(36) + editSeq.toString(36) + Math.random().toString(36).slice(2, 5); }

  function applyEdit(ws, e) {
    const p = e.payload || {};
    const eff = e.effective_at;
    const findOpp = (id) => { const o = ws.opportunities.find((x) => x.opportunity_id === id); if (!o) throw new Error('Unknown opportunity ' + id); return o; };
    switch (e.type) {
      case 'opp_stage': {
        const o = findOpp(p.opportunity_id);
        const cur = latestBy(ws.opp_history.filter((h) => h.opportunity_id === o.opportunity_id), (h) => h.opportunity_id, (h) => h.effective_at, '9999')[o.opportunity_id] || {};
        const stage = p.stage || cur.stage || 'prospecting';
        if (!STAGES.includes(stage)) throw new Error('Unknown stage ' + stage);
        const proposed = p.proposed_value_inr != null ? Number(p.proposed_value_inr) : (cur.proposed_value_inr || 0);
        let confirmed = p.confirmed_value_inr != null ? Number(p.confirmed_value_inr) : (stage === 'partner_confirmed' ? proposed : 0);
        if (stage !== 'partner_confirmed') confirmed = 0;
        ws.opp_history.push({ opportunity_name: o.opportunity_name, brand_name: o.brand_name, stage, proposed_value_inr: proposed, confirmed_value_inr: confirmed,
          owner_name: p.owner_name || cur.owner_name || null, effective_at: eff, history_id: 'E-' + e.id, opportunity_id: o.opportunity_id, brand_id: o.brand_id, owner_id: p.owner_id || cur.owner_id || null, _edit: e.id });
        if (p.property_id !== undefined) o.property_id = p.property_id;
        break;
      }
      case 'opp_create': {
        let brand = ws.brands.find((b) => b.brand_id === p.brand_id || (p.brand_name && b.brand_name.toLowerCase() === String(p.brand_name).toLowerCase()));
        if (!brand) {
          brand = { brand_name: p.brand_name, industry: p.industry || 'Unspecified', owner_name: p.owner_name || null, created_at: eff, brand_id: 'N' + e.id.slice(-6), owner_id: null, _edit: e.id };
          ws.brands.push(brand);
        }
        const camp = ws.campaigns.find((c) => c.sponsor_campaign_id === p.sponsor_campaign_id) || ws.campaigns.find((c) => c.campaign_name === p.campaign_name);
        const oid = 'N-' + e.id.slice(-6);
        ws.opportunities.push({ opportunity_name: brand.brand_name + ' festival partnership', brand_name: brand.brand_name, primary_contact_name: p.contact_name || null,
          originating_campaign_name: camp ? camp.campaign_name : null, support_type: p.support_type || 'cash', created_at: eff, opportunity_id: oid, brand_id: brand.brand_id,
          primary_contact_id: null, sponsor_campaign_id: camp ? camp.sponsor_campaign_id : null, bet_id: p.bet_id || null, property_id: p.property_id || null, _edit: e.id });
        ws.opp_history.push({ opportunity_name: brand.brand_name + ' festival partnership', brand_name: brand.brand_name, stage: p.stage || 'prospecting', proposed_value_inr: Number(p.proposed_value_inr || 0),
          confirmed_value_inr: p.stage === 'partner_confirmed' ? Number(p.proposed_value_inr || 0) : 0, owner_name: p.owner_name || null, effective_at: eff, history_id: 'E-' + e.id, opportunity_id: oid, brand_id: brand.brand_id, owner_id: null, _edit: e.id });
        break;
      }
      case 'interaction_add': {
        const brand = ws.brands.find((b) => b.brand_id === p.brand_id); if (!brand) throw new Error('Unknown brand ' + p.brand_id);
        const camp = ws.campaigns.find((c) => c.sponsor_campaign_id === p.sponsor_campaign_id); if (!camp) throw new Error('Unknown campaign ' + p.sponsor_campaign_id);
        ws.interactions.push({ brand_name: brand.brand_name, contact_name: p.contact_name || null, campaign_name: camp.campaign_name, channel: camp.channel, event_type: p.event_type,
          outcome: p.outcome, summary: p.summary || 'Logged in Growth Center.', occurred_at: eff, interaction_id: 'E-' + e.id, attempt_id: p.attempt_id || ('EA-' + e.id),
          origin_interaction_id: p.origin_interaction_id || null, brand_id: brand.brand_id, contact_id: p.contact_id || null, sponsor_campaign_id: camp.sponsor_campaign_id, owner_id: camp.owner_id, _edit: e.id });
        break;
      }
      case 'qual_set': {
        const brand = ws.brands.find((b) => b.brand_id === p.brand_id); if (!brand) throw new Error('Unknown brand ' + p.brand_id);
        if (!QUAL_STATUSES.includes(p.qualification_status)) throw new Error('Unknown status ' + p.qualification_status);
        const prev = latestBy(ws.qualification.filter((q) => q.brand_id === p.brand_id), (q) => q.brand_id, (q) => q.effective_at, '9999')[p.brand_id];
        const camp = ws.campaigns.find((c) => c.sponsor_campaign_id === (p.sponsor_campaign_id || (prev && prev.sponsor_campaign_id)));
        ws.qualification.push({ brand_name: brand.brand_name, qualification_status: p.qualification_status, reason: p.reason || 'Updated in Growth Center.', source_campaign_name: camp ? camp.campaign_name : null,
          effective_at: eff, history_id: 'E-' + e.id, brand_id: brand.brand_id, sponsor_campaign_id: camp ? camp.sponsor_campaign_id : null, _edit: e.id });
        break;
      }
      case 'campaign_update': {
        const c = ws.campaigns.find((x) => x.sponsor_campaign_id === p.sponsor_campaign_id); if (!c) throw new Error('Unknown campaign ' + p.sponsor_campaign_id);
        for (const [k, v] of Object.entries(p.fields || {})) {
          if (!['status', 'budget_inr', 'spend_inr', 'owner_name', 'notes', 'planned_end_at', 'plan'].includes(k)) throw new Error('Field not editable: ' + k);
          c[k] = (k === 'budget_inr' || k === 'spend_inr') ? (v === null || v === '' ? null : Number(v)) : v;
        }
        break;
      }
      case 'campaign_create': {
        ws.campaigns.push({ campaign_name: p.campaign_name, channel: p.channel || 'email', objective: p.objective || '', audience: p.audience || '', owner_name: p.owner_name || null,
          planned_start_at: p.planned_start_at || eff, planned_end_at: p.planned_end_at || null, created_at: eff, sponsor_campaign_id: 'NC-' + e.id.slice(-5), owner_id: null,
          status: 'active', budget_inr: p.budget_inr != null ? Number(p.budget_inr) : null, spend_inr: 0, _edit: e.id });
        break;
      }
      case 'target_set': {
        const prev = latestBy(ws.targets, () => 'k', (t) => t.effective_at, '9999').k || {};
        ws.targets.push(Object.assign({}, prev, p, { effective_at: eff, target_version: p.target_version || 'Edited target', _edit: e.id }));
        break;
      }
      case 'task_create': {
        ws.tasks.push(Object.assign({ task_id: 'TK-' + e.id.slice(-6), status: 'todo', priority: 'medium', created_at: e.at, source: e.source || 'user' }, p, { _edit: e.id }));
        break;
      }
      case 'task_update': {
        const t = ws.tasks.find((x) => x.task_id === p.task_id); if (!t) throw new Error('Unknown task ' + p.task_id);
        Object.assign(t, p.fields || {}); t.updated_at = e.at;
        break;
      }
      case 'task_delete': { ws.tasks = ws.tasks.filter((x) => x.task_id !== p.task_id); break; }
      case 'payment_add': {
        ws.payments.push(Object.assign({ payment_id: 'PY-' + e.id.slice(-6), status: 'issued' }, p, { _edit: e.id }));
        break;
      }
      case 'payment_update': {
        const py = ws.payments.find((x) => x.payment_id === p.payment_id); if (!py) throw new Error('Unknown payment ' + p.payment_id);
        Object.assign(py, p.fields || {});
        break;
      }
      case 'bet_update': {
        if (!ws.plan) throw new Error('This workspace has no plan');
        const b = ws.plan.bets.find((x) => x.bet_id === p.bet_id); if (!b) throw new Error('Unknown bet ' + p.bet_id);
        if (p.signals) b.signals = Object.assign({}, b.signals, p.signals);
        for (const k of ['status', 'hours_logged', 'spend_inr', 'fulfil_quote_inr', 'owner_name', 'notes']) if (p[k] !== undefined) b[k] = p[k];
        break;
      }
      case 'setting_update': {
        ws.settings = deepMerge(ws.settings, p);
        break;
      }
      default: throw new Error('Unknown edit type ' + e.type);
    }
  }
  function deepMerge(a, b) { const out = clone(a); for (const [k, v] of Object.entries(b || {})) out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? deepMerge(out[k] || {}, v) : v; return out; }

  function describeEdit(ws, e) {
    const p = e.payload || {};
    const nm = (id) => { const o = ws.opportunities.find((x) => x.opportunity_id === id); return o ? o.brand_name : id; };
    const map = {
      opp_stage: () => `Deal ${nm(p.opportunity_id)} → ${p.stage || 'value change'}${p.proposed_value_inr != null ? ' at ₹' + lakh(p.proposed_value_inr) + 'L' : ''}`,
      opp_create: () => `New deal: ${p.brand_name || p.brand_id} (${p.stage || 'prospecting'})`,
      interaction_add: () => `Logged ${p.event_type} for brand ${p.brand_id}`,
      qual_set: () => `Brand ${p.brand_id} qualification → ${p.qualification_status}`,
      campaign_update: () => `Campaign ${p.sponsor_campaign_id}: ${Object.entries(p.fields || {}).map(([k, v]) => k + '=' + v).join(', ')}`,
      campaign_create: () => `New campaign: ${p.campaign_name}`,
      target_set: () => `Targets updated (${Object.keys(p).filter((k) => k !== 'target_version').join(', ')})`,
      task_create: () => `Task created: ${p.title}${e.source === 'ai' ? ' (from AI analyst, confirmed)' : ''}`,
      task_update: () => `Task ${p.task_id}: ${Object.entries(p.fields || {}).map(([k, v]) => k + '=' + v).join(', ')}`,
      task_delete: () => `Task ${p.task_id} deleted`,
      payment_add: () => `Invoice added: ₹${lakh(p.amount_inr)}L`,
      payment_update: () => `Payment ${p.payment_id}: ${Object.entries(p.fields || {}).map(([k, v]) => k + '=' + v).join(', ')}`,
      bet_update: () => `Bet ${p.bet_id} updated`,
      setting_update: () => `Settings changed`,
    };
    return { id: e.id, at: e.at, effective_at: e.effective_at, type: e.type, source: e.source || 'user', actor: e.actor || null, text: (map[e.type] || (() => e.type))() };
  }

  // ---------- snapshot ----------
  function snapshot(ws, asOf) {
    const cutoff = cutoffOf(asOf);
    const brands = ws.brands.filter((b) => (b.created_at || '') <= cutoff);
    const contacts = ws.contacts.filter((c) => (c.created_at || '') <= cutoff);
    const interactions = ws.interactions.filter((i) => (i.occurred_at || '') <= cutoff);
    const qualLatest = latestBy(ws.qualification, (q) => q.brand_id, (q) => q.effective_at, cutoff);
    const oppHistAsOf = ws.opp_history.filter((h) => (h.effective_at || '') <= cutoff);
    const oppLatest = latestBy(oppHistAsOf, (h) => h.opportunity_id, (h) => h.effective_at, cutoff);
    const maxRank = {}; const firstAt = {};
    for (const h of oppHistAsOf) {
      const r = STAGE_RANK[h.stage] || 0; const id = h.opportunity_id;
      if (!maxRank[id] || r > maxRank[id]) maxRank[id] = r;
      (firstAt[id] = firstAt[id] || {});
      if (!firstAt[id][h.stage] || h.effective_at < firstAt[id][h.stage]) firstAt[id][h.stage] = h.effective_at;
    }
    const campaignsById = Object.fromEntries(ws.campaigns.map((c) => [c.sponsor_campaign_id, c]));
    const opps = ws.opportunities.filter((o) => (o.created_at || '') <= cutoff).map((o) => {
      const l = oppLatest[o.opportunity_id];
      const stage = l ? l.stage : null;
      const last = l ? l.effective_at : o.created_at;
      return Object.assign({}, o, {
        stage, stage_label: stage || 'no stage record yet',
        proposed_value_inr: l ? Number(l.proposed_value_inr) || 0 : 0,
        confirmed_value_inr: l ? Number(l.confirmed_value_inr) || 0 : 0,
        deal_owner: l ? l.owner_name : null,
        last_change_at: last, days_in_stage: daysBetween(last, cutoff),
        max_stage_rank: maxRank[o.opportunity_id] || 0,
        reached_proposal: (maxRank[o.opportunity_id] || 0) >= 3,
        confirmed_at: stage === 'partner_confirmed' ? (firstAt[o.opportunity_id] || {}).partner_confirmed : null,
        is_open: OPEN_STAGES.includes(stage) || stage === null,
        campaign_name: (campaignsById[o.sponsor_campaign_id] || {}).campaign_name || o.originating_campaign_name,
      });
    });
    const targets = latestBy(ws.targets, () => 'k', (t) => t.effective_at, cutoff).k || null;
    const payments = (ws.payments || []).filter((p) => (p.issued_at || '') <= cutoff).map((p) => Object.assign({}, p, {
      paid_as_of: p.paid_at && p.paid_at <= cutoff, overdue_as_of: !(p.paid_at && p.paid_at <= cutoff) && p.due_date && p.due_date < asOf,
    }));
    return { ws, asOf, cutoff, brands, contacts, interactions, qualLatest, opps, targets, payments, campaignsById };
  }

  // ---------- brand-level touch facts ----------
  function brandFacts(snap) {
    const f = {};
    const get = (id) => (f[id] = f[id] || { reached: false, responded: false, positive: false, meeting_held: false, opted_out: false, campaigns: new Set(), first_touch: null });
    for (const i of snap.interactions) {
      const b = get(i.brand_id); b.campaigns.add(i.sponsor_campaign_id);
      if (ROOT_EVENTS.includes(i.event_type)) { b.reached = true; if (!b.first_touch || i.occurred_at < b.first_touch) b.first_touch = i.occurred_at; }
      if ((i.event_type === 'replied' && i.outcome !== 'wrong_contact') || i.event_type === 'web_inbound') b.responded = true;
      if ((i.event_type === 'replied' && i.outcome === 'positive') || i.event_type === 'web_inbound') b.positive = true;
      if (i.event_type === 'meeting_held') b.meeting_held = true;
      if (i.event_type === 'opt_out') b.opted_out = true;
    }
    return f;
  }

  // ---------- win probabilities ----------
  function stageWinRates(snap) {
    const s = snap.ws.settings;
    const closed = snap.opps.filter((o) => ['partner_confirmed', 'lost', 'withdrawn'].includes(o.stage));
    const K = s.shrinkage_k ?? 3;
    const out = { basis: null, closed_deals: closed.length, rates: {}, by_campaign: {} };
    const rateFor = (rows, st, fallback) => {
      const r = STAGE_RANK[st];
      const reached = rows.filter((o) => o.max_stage_rank >= r);
      const won = reached.filter((o) => o.stage === 'partner_confirmed').length;
      return { won, closed_reached: reached.length, raw: reached.length ? won / reached.length : null,
        p: round((won + K * fallback) / (reached.length + K), 3) };
    };
    if (closed.length >= s.min_closed_for_empirical) {
      out.basis = `CALC: empirical stage win rates from ${closed.length} closed deals as of ${snap.asOf}, shrunk toward the overall rate per originating campaign (k=${K})`;
      for (const st of OPEN_STAGES) {
        const all = rateFor(closed, st, s.stage_win_prior[st]);
        out.rates[st] = { p: all.closed_reached ? round(all.raw, 3) : s.stage_win_prior[st], won: all.won, closed_reached: all.closed_reached, source: all.closed_reached ? 'empirical' : 'prior' };
      }
      const byC = groupBy(closed, (o) => o.sponsor_campaign_id || 'none');
      for (const c of snap.ws.campaigns) {
        const rows = byC[c.sponsor_campaign_id] || [];
        out.by_campaign[c.sponsor_campaign_id] = Object.fromEntries(OPEN_STAGES.map((st) => { const x = rateFor(rows, st, out.rates[st].p); return [st, { p: x.p, won: x.won, closed_reached: x.closed_reached }]; }));
      }
    } else {
      out.basis = `ASSUMPTION: only ${closed.length} closed deals (< ${s.min_closed_for_empirical}), so stage priors from settings are used`;
      for (const st of OPEN_STAGES) out.rates[st] = { p: s.stage_win_prior[st], source: 'prior' };
    }
    // Idle rule (CALC): the longest gap between stage changes on any won deal. Open deals idle longer than that
    // take the shrunk win rate of closed deals that also sat idle that long.
    const hist = groupBy(snap.ws.opp_history.filter((h) => h.effective_at <= snap.cutoff), (h) => h.opportunity_id);
    const maxGap = (id) => { const hs = (hist[id] || []).map((h) => h.effective_at).sort(); let g = 0; for (let i = 1; i < hs.length; i++) g = Math.max(g, daysBetween(hs[i - 1], hs[i])); return g; };
    const won = closed.filter((o) => o.stage === 'partner_confirmed');
    if (won.length >= 3) {
      const thr = Math.max(s.idle_floor_days ?? 3, ...won.map((o) => maxGap(o.opportunity_id)));
      const idleClosed = closed.filter((o) => maxGap(o.opportunity_id) > thr);
      const idleWon = idleClosed.filter((o) => o.stage === 'partner_confirmed').length;
      const prior = s.idle_prior ?? 0.25;
      out.idle = { threshold_days: thr, closed_deals_that_went_idle: idleClosed.length, of_which_won: idleWon, p: round((idleWon + K * prior) / (idleClosed.length + K), 3),
        rule: `Won deals never sat more than ${thr} days without a stage change; open deals idle longer use the idle win rate instead of the stage rate.` };
    }
    out.pFor = (o) => {
      const st = OPEN_STAGES.includes(o.stage) ? o.stage : 'prospecting';
      if (out.idle && o.days_in_stage > out.idle.threshold_days) return Math.min(out.idle.p, (out.by_campaign[o.sponsor_campaign_id] || out.rates)[st].p ?? out.idle.p);
      const c = out.by_campaign[o.sponsor_campaign_id];
      return c ? c[st].p : out.rates[st].p;
    };
    return out;
  }

  // ---------- core metrics ----------
  function overview(snap) {
    const facts = brandFacts(snap);
    const ws = snap.ws;
    const bf = Object.values(facts);
    const quals = Object.values(snap.qualLatest).filter((q) => snap.brands.some((b) => b.brand_id === q.brand_id));
    const qualCounts = Object.fromEntries(QUAL_STATUSES.map((s) => [s, quals.filter((q) => q.qualification_status === s).length]));
    const confirmed = snap.opps.filter((o) => o.stage === 'partner_confirmed');
    const open = snap.opps.filter((o) => o.is_open);
    const wr = stageWinRates(snap);
    const eventPassed = ws.event && ws.event.event_starts_at && snap.cutoff >= ws.event.event_starts_at;
    const weighted = eventPassed ? 0 : sum(open, (o) => o.proposed_value_inr * wr.pFor(o));
    const conf = {
      count: confirmed.length, value_inr: sum(confirmed, (o) => o.confirmed_value_inr),
      cash_count: confirmed.filter((o) => o.support_type === 'cash').length, cash_value_inr: sum(confirmed.filter((o) => o.support_type === 'cash'), (o) => o.confirmed_value_inr),
      in_kind_count: confirmed.filter((o) => o.support_type !== 'cash').length, in_kind_value_inr: sum(confirmed.filter((o) => o.support_type !== 'cash'), (o) => o.confirmed_value_inr),
    };
    conf.avg_cash_deal_inr = conf.cash_count ? round(conf.cash_value_inr / conf.cash_count, 0) : null;
    const t = snap.targets || {};
    const ev = ws.event || {};
    const daysToEvent = ev.event_starts_at ? daysBetween(snap.cutoff, ev.event_starts_at) : null;
    const res = {
      workspace: ws.workspace.name, as_of: snap.asOf, event: ev.event_name, event_starts_at: ev.event_starts_at, days_to_event: daysToEvent,
      brands_in_pipeline: snap.brands.length,
      brands_reached: bf.filter((b) => b.reached).length,
      brands_responded: bf.filter((b) => b.responded).length,
      brands_positive: bf.filter((b) => b.positive).length,
      brands_meeting_held: bf.filter((b) => b.meeting_held).length,
      brands_opted_out: bf.filter((b) => b.opted_out).length,
      qualification: qualCounts,
      brands_without_qualification_record: snap.brands.length - quals.length,
      opportunities: snap.opps.length,
      opportunities_open: open.length,
      opportunities_reached_proposal: snap.opps.filter((o) => o.reached_proposal).length,
      confirmed: conf,
      lost: snap.opps.filter((o) => o.stage === 'lost').length, withdrawn: snap.opps.filter((o) => o.stage === 'withdrawn').length,
      open_pipeline_inr: sum(open, (o) => o.proposed_value_inr),
      weighted_open_pipeline_inr: round(weighted, 0),
      projected_confirmed_value_inr: round(conf.value_inr + weighted, 0),
      win_rate_basis: eventPassed ? 'Event has started: open deals are not counted toward the projection.' : wr.basis,
      targets: snap.targets ? {
        version: t.target_version, effective_at: t.effective_at,
        qualified_brands_goal: t.qualified_brands_goal, qualified_brands_actual: qualCounts.qualified, qualified_brands_attainment_pct: pct(qualCounts.qualified, t.qualified_brands_goal),
        confirmed_partnerships_goal: t.confirmed_partnerships_goal, confirmed_partnerships_actual: conf.count, confirmed_partnerships_attainment_pct: pct(conf.count, t.confirmed_partnerships_goal),
        signed_value_goal_inr: t.signed_value_goal_inr ?? null, signed_value_actual_inr: t.signed_value_goal_inr != null ? conf.cash_value_inr : null, signed_value_attainment_pct: t.signed_value_goal_inr ? pct(conf.cash_value_inr, t.signed_value_goal_inr) : null,
        cash_goal_inr: t.cash_goal_inr ?? null,
        target_counts_include_in_kind: true,
      } : null,
    };
    if ((snap.payments || []).length || ws.plan) {
      const rec = snap.payments.filter((p) => p.paid_as_of);
      res.cash = { invoiced_inr: sum(snap.payments, (p) => p.amount_inr), received_inr: sum(rec, (p) => p.amount_inr), overdue_inr: sum(snap.payments.filter((p) => p.overdue_as_of), (p) => p.amount_inr), overdue_invoices: snap.payments.filter((p) => p.overdue_as_of).length };
    } else {
      res.cash = { available: false, note: 'This dataset records confirmed partnership values only; it has no invoices or bank receipts, so cash collected cannot be measured.' };
    }
    return res;
  }

  function funnel(snap, groupBy) {
    const facts = brandFacts(snap);
    const stageDefs = [
      ['brands_in_pipeline', 'Brands in pipeline', 'brand'], ['reached', 'Reached (outreach, intro or inbound)', 'brand'], ['responded', 'Responded', 'brand'],
      ['meeting_held', 'Meeting held', 'brand'], ['qualified', 'Qualified (latest status)', 'brand'], ['opportunities', 'Opportunities opened', 'opportunity'],
      ['proposal', 'Proposal sent (ever)', 'opportunity'], ['confirmed', 'Partner confirmed', 'opportunity'],
    ];
    const compute = (brandIds, opps) => {
      const f = brandIds.map((id) => facts[id] || {});
      const q = brandIds.filter((id) => (snap.qualLatest[id] || {}).qualification_status === 'qualified').length;
      const vals = { brands_in_pipeline: brandIds.length, reached: f.filter((x) => x.reached).length, responded: f.filter((x) => x.responded).length, meeting_held: f.filter((x) => x.meeting_held).length,
        qualified: q, opportunities: opps.length, proposal: opps.filter((o) => o.reached_proposal).length, confirmed: opps.filter((o) => o.stage === 'partner_confirmed').length };
      const stages = stageDefs.map(([k, label, unit], i) => ({ key: k, label, unit, value: vals[k], conv_from_prev_pct: i && stageDefs[i - 1][2] === unit ? pct(vals[k], vals[stageDefs[i - 1][0]]) : null }));
      return { stages, confirmed_value_inr: sum(opps.filter((o) => o.stage === 'partner_confirmed'), (o) => o.confirmed_value_inr) };
    };
    const allIds = snap.brands.map((b) => b.brand_id);
    if (!groupBy || groupBy === 'none') return { group_by: 'none', note: 'Brand stages count distinct brands; opportunity stages count deals (one brand can hold several).', overall: compute(allIds, snap.opps) };
    const groups = {};
    if (groupBy === 'campaign' || groupBy === 'channel') {
      const key = (cid) => groupBy === 'campaign' ? ((snap.campaignsById[cid] || {}).campaign_name || cid) : ((snap.campaignsById[cid] || {}).channel || 'unknown');
      for (const [bid, f] of Object.entries(facts)) for (const cid of f.campaigns) { const k = key(cid); (groups[k] = groups[k] || { brands: new Set(), opps: [] }).brands.add(bid); }
      // brands that were researched but never touched: attribute by latest qualification source
      for (const b of snap.brands) if (!facts[b.brand_id]) { const q = snap.qualLatest[b.brand_id]; const k = q ? key(q.sponsor_campaign_id) : 'Unattributed'; (groups[k] = groups[k] || { brands: new Set(), opps: [] }).brands.add(b.brand_id); }
      for (const o of snap.opps) { const k = key(o.sponsor_campaign_id); (groups[k] = groups[k] || { brands: new Set(), opps: [] }).opps.push(o); }
    } else {
      const bkey = groupBy === 'owner' ? (b) => b.owner_name || 'Unassigned' : groupBy === 'industry' ? (b) => b.industry || 'Unknown' : groupBy === 'domain' ? (b) => b.domain || b.industry || 'Unknown' : null;
      if (!bkey) throw new Error('group_by must be none, campaign, channel, owner, industry or domain');
      const bmap = Object.fromEntries(snap.brands.map((b) => [b.brand_id, b]));
      for (const b of snap.brands) { const k = bkey(b); (groups[k] = groups[k] || { brands: new Set(), opps: [] }).brands.add(b.brand_id); }
      for (const o of snap.opps) { const b = bmap[o.brand_id]; const k = groupBy === 'owner' ? (o.deal_owner || (b && b.owner_name) || 'Unassigned') : (b ? bkey(b) : 'Unknown'); (groups[k] = groups[k] || { brands: new Set(), opps: [] }).opps.push(o); }
    }
    return { group_by: groupBy, note: groupBy === 'campaign' || groupBy === 'channel' ? 'A brand touched by several campaigns counts in each (attribution is observational). Opportunities use their originating campaign.' : 'Brands grouped by their record; deals by deal owner where grouping by owner.',
      groups: Object.entries(groups).map(([k, g]) => Object.assign({ group: k }, compute(Array.from(g.brands), g.opps))).sort((a, b) => b.confirmed_value_inr - a.confirmed_value_inr) };
  }

  function campaignKpis(snap) {
    const s = snap.ws.settings.verdict;
    const byC = groupBy(snap.interactions, (i) => i.sponsor_campaign_id);
    const oppsByC = groupBy(snap.opps, (o) => o.sponsor_campaign_id);
    const qualByC = groupBy(Object.values(snap.qualLatest), (q) => q.sponsor_campaign_id);
    return snap.ws.campaigns.filter((c) => (c.created_at || '') <= snap.cutoff || true).map((c) => {
      const ints = byC[c.sponsor_campaign_id] || [];
      const cnt = (t, o) => ints.filter((i) => i.event_type === t && (!o || i.outcome === o)).length;
      const roots = ints.filter((i) => ROOT_EVENTS.includes(i.event_type));
      const attempts = uniq(roots.map((i) => i.attempt_id)).length;
      const brandsReached = uniq(roots.map((i) => i.brand_id)).length;
      const replies = cnt('replied'); const positive = cnt('replied', 'positive');
      const respondingBrands = uniq(ints.filter((i) => i.event_type === 'replied' || i.event_type === 'web_inbound').map((i) => i.brand_id)).length;
      const opps = oppsByC[c.sponsor_campaign_id] || [];
      const conf = opps.filter((o) => o.stage === 'partner_confirmed');
      const closed = opps.filter((o) => ['partner_confirmed', 'lost', 'withdrawn'].includes(o.stage));
      const open = opps.filter((o) => o.is_open);
      const cycle = conf.map((o) => daysBetween(o.created_at, o.confirmed_at)).filter((x) => x != null);
      const qualified = (qualByC[c.sponsor_campaign_id] || []).filter((q) => q.qualification_status === 'qualified').length;
      const confValue = sum(conf, (o) => o.confirmed_value_inr);
      const k = {
        sponsor_campaign_id: c.sponsor_campaign_id, campaign_name: c.campaign_name, channel: c.channel, owner_name: c.owner_name, status: c.status || 'active',
        planned_start_at: c.planned_start_at, planned_end_at: c.planned_end_at,
        attempts, brands_reached: brandsReached, outreach_sent: cnt('outreach_sent'), delivered: cnt('delivered'), intros_received: cnt('introduction_received'), inbound_submissions: cnt('web_inbound'),
        delivery_rate_pct: cnt('outreach_sent') ? pct(cnt('delivered'), cnt('outreach_sent')) : null,
        replies, positive_replies: positive, reply_rate_pct: pct(replies, attempts), positive_reply_rate_pct: pct(positive, attempts),
        responding_brands: respondingBrands, meetings_booked: cnt('meeting_booked'), meetings_held: cnt('meeting_held'), opt_outs: cnt('opt_out'),
        qualified_brands: qualified,
        opportunities: opps.length, proposals: opps.filter((o) => o.reached_proposal).length, open_opportunities: open.length,
        confirmed: conf.length, confirmed_cash: conf.filter((o) => o.support_type === 'cash').length, lost_or_withdrawn: closed.length - conf.length,
        win_rate_closed_pct: pct(conf.length, closed.length), opp_to_win_pct: pct(conf.length, opps.length),
        confirmed_value_inr: confValue, confirmed_cash_value_inr: sum(conf.filter((o) => o.support_type === 'cash'), (o) => o.confirmed_value_inr),
        avg_deal_inr: conf.length ? round(confValue / conf.length, 0) : null, open_pipeline_inr: sum(open, (o) => o.proposed_value_inr),
        median_days_open_to_confirmed: median(cycle),
        budget_inr: c.budget_inr ?? null, spend_inr: c.spend_inr ?? null,
        cost_per_confirmed_inr: c.spend_inr != null && conf.length ? round(c.spend_inr / conf.length, 0) : null,
        value_per_rupee_spent: c.spend_inr ? round(confValue / c.spend_inr, 2) : null,
        plan: c.plan || null, notes: c.notes || null,
      };
      // verdict (rules in settings, documented in README)
      let verdict = 'watch'; let why = 'Not enough activity yet to judge.';
      const posRate = k.positive_reply_rate_pct ?? 0;
      if (k.status === 'stopped') { verdict = 'stopped'; why = 'Stopped by the team.'; }
      else if (k.confirmed >= s.scale_min_wins && (k.win_rate_closed_pct ?? 0) >= s.scale_min_win_rate) { verdict = 'scale'; why = `${k.confirmed} confirmed at a ${k.win_rate_closed_pct}% win rate on closed deals (rule: ≥${s.scale_min_wins} wins and ≥${s.scale_min_win_rate}%).`; }
      else if (k.attempts >= s.stop_min_attempts && k.confirmed === 0 && posRate < s.stop_max_positive_rate) { verdict = 'stop'; why = `${k.attempts} attempts, 0 confirmed, ${posRate}% positive replies (rule: ≥${s.stop_min_attempts} attempts, no wins, positive rate <${s.stop_max_positive_rate}%).`; }
      else if (k.attempts >= s.watch_min_attempts && k.confirmed === 0) { verdict = 'change'; why = `${k.attempts} attempts and ${k.opportunities} deals opened but none confirmed; replies exist (${posRate}% positive), so fix conversion before adding volume.`; }
      else if (k.confirmed > 0) { verdict = 'keep'; why = `${k.confirmed} confirmed; below the scale bar (≥${s.scale_min_wins} wins at ≥${s.scale_min_win_rate}%).`; }
      const plan = snap.ws.plan;
      if (plan && c.plan && k.status !== 'stopped') {
        const wk = Math.max(1, weekOf(plan, snap.asOf));
        const share = (m) => { const r = plan.ramp[m]; return r[Math.min(wk, r.length) - 1]; };
        const exp = { conversations: c.plan.conversations * share('conversations'), proposals: c.plan.proposals * share('proposals'), signed_inr: c.plan.signed_inr * share('signed') };
        const pace = { conversations: exp.conversations ? round(k.responding_brands / exp.conversations, 2) : null, proposals: exp.proposals ? round(k.proposals / exp.proposals, 2) : null, signed: exp.signed_inr ? round(k.confirmed_value_inr / exp.signed_inr, 2) : null };
        k.plan_pace = { week: wk, expected_by_now: { conversations: round(exp.conversations, 1), proposals: round(exp.proposals, 1), signed_inr: round(exp.signed_inr, 0) }, pace, basis: 'ASSUMPTION: Task 1 ramp (25 of 62 conversations, 12 of 36 proposals and ₹4L of ₹24L signed by end of week 4)' };
        const vals = Object.values(pace).filter((x) => x != null);
        const lo = Math.min(...vals);
        const gate = c.plan.gate;
        if (gate && wk >= gate.week && (k[gate.metric] ?? 0) < gate.min) { verdict = 'change'; why = `${gate.label}: ${k[gate.metric] ?? 0} by week ${gate.week} (gate ${gate.min}). ${gate.action}`; }
        else if (wk >= 4 && pace.conversations != null && pace.conversations < 0.5) { verdict = 'stop'; why = `Conversations at ${Math.round(pace.conversations * 100)}% of plan pace by week ${wk}.`; }
        else if (vals.every((x) => x >= 1)) { verdict = 'scale'; why = `Ahead of plan pace on conversations (${pace.conversations}×), proposals (${pace.proposals}×) and signed value (${pace.signed}×).`; }
        else if (lo < 0.7) { const m = Object.entries(pace).find(([, v]) => v === lo)[0]; verdict = 'change'; why = `${m} at ${Math.round(lo * 100)}% of plan pace by week ${wk} (expected ${m === 'signed' ? '₹' + lakh(exp.signed_inr) + 'L' : round(exp[m], 1)}).`; }
        else { verdict = 'keep'; why = `Within 70% of plan pace on every stage (lowest ${Math.round(lo * 100)}%).`; }
      }
      k.verdict = verdict; k.verdict_reason = why;
      return k;
    });
  }

  function listOpportunities(snap, f = {}) {
    let rows = snap.opps;
    if (f.stage) { const st = [].concat(f.stage); rows = rows.filter((o) => st.includes(o.stage) || (st.includes('open') && o.is_open)); }
    if (f.open_only) rows = rows.filter((o) => o.is_open);
    if (f.campaign) rows = rows.filter((o) => (o.campaign_name || '').toLowerCase().includes(String(f.campaign).toLowerCase()) || o.sponsor_campaign_id === f.campaign);
    if (f.owner) rows = rows.filter((o) => (o.deal_owner || '').toLowerCase().includes(String(f.owner).toLowerCase()));
    if (f.support_type) rows = rows.filter((o) => o.support_type === f.support_type);
    if (f.bet_id) rows = rows.filter((o) => o.bet_id === f.bet_id);
    if (f.brand) rows = rows.filter((o) => (o.brand_name || '').toLowerCase().includes(String(f.brand).toLowerCase()));
    if (f.min_value_inr != null) rows = rows.filter((o) => o.proposed_value_inr >= f.min_value_inr);
    if (f.stale_days != null) rows = rows.filter((o) => o.is_open && o.days_in_stage >= f.stale_days);
    const sorters = { value: (a, b) => b.proposed_value_inr - a.proposed_value_inr, age: (a, b) => b.days_in_stage - a.days_in_stage, created: (a, b) => (a.created_at || '').localeCompare(b.created_at || '') };
    rows = [...rows].sort(sorters[f.sort] || sorters.value);
    return rows.map((o) => ({ opportunity_id: o.opportunity_id, brand: o.brand_name, brand_id: o.brand_id, stage: o.stage_label, support_type: o.support_type, proposed_value_inr: o.proposed_value_inr, confirmed_value_inr: o.confirmed_value_inr,
      campaign: o.campaign_name, deal_owner: o.deal_owner, created_at: dateOf(o.created_at), last_change: dateOf(o.last_change_at), days_in_stage: o.days_in_stage, reached_proposal: o.reached_proposal, bet_id: o.bet_id || undefined, property_id: o.property_id || undefined }));
  }

  function bottlenecks(snap) {
    const s = snap.ws.settings;
    const facts = brandFacts(snap);
    const out = [];
    const engagedNoQual = Object.values(snap.qualLatest).filter((q) => q.qualification_status === 'engaged');
    const posNotQualified = Object.entries(facts).filter(([id, f]) => f.positive && !['qualified', 'unqualified'].includes((snap.qualLatest[id] || {}).qualification_status)).map(([id]) => id);
    const stale = snap.opps.filter((o) => o.is_open && o.days_in_stage >= s.stale_days);
    const unreviewed = Object.values(snap.qualLatest).filter((q) => q.qualification_status === 'unreviewed');
    const metNoOpp = Object.entries(facts).filter(([id, f]) => f.meeting_held && !snap.opps.some((o) => o.brand_id === id)).map(([id]) => id);
    const fun = funnel(snap).overall.stages;
    let worst = null;
    for (const st of fun.slice(1)) if (st.conv_from_prev_pct != null && (!worst || st.conv_from_prev_pct < worst.conv_from_prev_pct)) worst = st;
    out.push({ type: 'largest_funnel_drop', detail: worst ? `${worst.label}: ${worst.conv_from_prev_pct}% of the previous stage` : null });
    out.push({ type: 'positive_responders_not_yet_qualified', count: posNotQualified.length, brands: posNotQualified.slice(0, 15).map((id) => (snap.brands.find((b) => b.brand_id === id) || {}).brand_name) });
    out.push({ type: 'engaged_brands_awaiting_qualification', count: engagedNoQual.length });
    out.push({ type: 'meeting_held_but_no_deal', count: metNoOpp.length, brands: metNoOpp.slice(0, 15).map((id) => (snap.brands.find((b) => b.brand_id === id) || {}).brand_name) });
    out.push({ type: 'stale_open_deals', threshold_days: s.stale_days, count: stale.length, value_inr: sum(stale, (o) => o.proposed_value_inr), deals: stale.sort((a, b) => b.days_in_stage - a.days_in_stage).slice(0, 12).map((o) => ({ brand: o.brand_name, stage: o.stage, days: o.days_in_stage, value_inr: o.proposed_value_inr, owner: o.deal_owner })) });
    out.push({ type: 'unreviewed_brands', count: unreviewed.length });
    const camps = campaignKpis(snap);
    out.push({ type: 'campaigns_flagged', items: camps.filter((c) => ['stop', 'change'].includes(c.verdict)).map((c) => ({ campaign: c.campaign_name, verdict: c.verdict, reason: c.verdict_reason })) });
    // owner load
    const openByOwner = groupBy(snap.opps.filter((o) => o.is_open), (o) => o.deal_owner || 'Unassigned');
    out.push({ type: 'open_deals_by_owner', items: Object.entries(openByOwner).map(([k, v]) => ({ owner: k, open_deals: v.length, open_value_inr: sum(v, (o) => o.proposed_value_inr) })) });
    return out;
  }

  function weeklySeries(ws, asOf, metrics) {
    const start = dateOf((ws.event && ws.event.history_start) || ws.workspace.history_start);
    const weeks = [];
    for (let d = addDays(start, 6); d < asOf; d = addDays(d, 7)) weeks.push(d);
    weeks.push(asOf);
    return weeks.map((d) => {
      const sn = snapshot(ws, d);
      const conf = sn.opps.filter((o) => o.stage === 'partner_confirmed');
      const row = { week_ending: d };
      const all = {
        confirmed_count: () => conf.length,
        confirmed_value_inr: () => sum(conf, (o) => o.confirmed_value_inr),
        confirmed_cash_value_inr: () => sum(conf.filter((o) => o.support_type === 'cash'), (o) => o.confirmed_value_inr),
        qualified_brands: () => Object.values(sn.qualLatest).filter((q) => q.qualification_status === 'qualified').length,
        replies: () => sn.interactions.filter((i) => i.event_type === 'replied').length,
        meetings_held: () => sn.interactions.filter((i) => i.event_type === 'meeting_held').length,
        opportunities: () => sn.opps.length,
        open_pipeline_inr: () => sum(sn.opps.filter((o) => o.is_open), (o) => o.proposed_value_inr),
        proposals: () => sn.opps.filter((o) => o.reached_proposal).length,
        received_inr: () => sum(sn.payments.filter((p) => p.paid_as_of), (p) => p.amount_inr),
        target_confirmed: () => (sn.targets || {}).confirmed_partnerships_goal ?? null,
        target_qualified: () => (sn.targets || {}).qualified_brands_goal ?? null,
      };
      for (const m of metrics || Object.keys(all)) if (all[m]) row[m] = all[m]();
      return row;
    });
  }

  function brandDetail(snap, q) {
    const s = String(q || '').toLowerCase();
    const matches = snap.ws.brands.filter((b) => b.brand_id.toLowerCase() === s || b.brand_name.toLowerCase() === s);
    const b = matches[0] || snap.ws.brands.find((x) => x.brand_name.toLowerCase().includes(s));
    if (!b) return { found: false, note: `No brand matches "${q}" in this workspace.` };
    const inSnap = snap.brands.some((x) => x.brand_id === b.brand_id);
    return {
      found: true, exists_as_of: inSnap, brand_id: b.brand_id, brand_name: b.brand_name, industry: b.industry, domain: b.domain, owner: b.owner_name, created_at: b.created_at,
      contacts: snap.contacts.filter((c) => c.brand_id === b.brand_id).map((c) => ({ name: c.contact_name, title: c.job_title, contact_id: c.contact_id })),
      qualification_now: snap.qualLatest[b.brand_id] ? { status: snap.qualLatest[b.brand_id].qualification_status, reason: snap.qualLatest[b.brand_id].reason, since: snap.qualLatest[b.brand_id].effective_at, source_campaign: snap.qualLatest[b.brand_id].source_campaign_name } : null,
      qualification_history: snap.ws.qualification.filter((x) => x.brand_id === b.brand_id && x.effective_at <= snap.cutoff).sort((a, c) => a.effective_at.localeCompare(c.effective_at)).map((x) => [x.effective_at, x.qualification_status]),
      timeline: snap.interactions.filter((i) => i.brand_id === b.brand_id).sort((a, c) => a.occurred_at.localeCompare(c.occurred_at)).map((i) => `${i.occurred_at.replace('T', ' ').slice(0, 16)} · ${i.campaign_name} · ${i.event_type}/${i.outcome}${i.contact_name ? ' · ' + i.contact_name : ''}`),
      opportunities: snap.opps.filter((o) => o.brand_id === b.brand_id).map((o) => ({ id: o.opportunity_id, stage: o.stage_label, proposed_value_inr: o.proposed_value_inr, confirmed_value_inr: o.confirmed_value_inr, support_type: o.support_type, campaign: o.campaign_name, owner: o.deal_owner,
        history: snap.ws.opp_history.filter((h) => h.opportunity_id === o.opportunity_id && h.effective_at <= snap.cutoff).sort((a, c) => a.effective_at.localeCompare(c.effective_at)).map((h) => [h.effective_at, h.stage, h.proposed_value_inr]) })),
      activations: (snap.ws.activations || []).filter((a) => a.brand_id === b.brand_id && a.linked_at <= snap.cutoff).map((a) => ({ attendee_campaign: a.attendee_campaign_name, linked_at: a.linked_at, note: a.activation_note })),
      tasks: snap.ws.tasks.filter((t) => t.brand_id === b.brand_id || (t.title || '').toLowerCase().includes(b.brand_name.toLowerCase())).map((t) => ({ task_id: t.task_id, title: t.title, status: t.status, owner: t.owner, due: t.due_date })),
    };
  }

  function tasksView(snap, f = {}) {
    let rows = snap.ws.tasks.map((t) => Object.assign({}, t, { overdue: t.status !== 'done' && t.due_date && t.due_date < snap.asOf }));
    if (f.status) rows = rows.filter((t) => t.status === f.status);
    if (f.owner) rows = rows.filter((t) => (t.owner || '').toLowerCase().includes(String(f.owner).toLowerCase()));
    if (f.overdue_only) rows = rows.filter((t) => t.overdue);
    if (f.linked_id) rows = rows.filter((t) => t.linked_id === f.linked_id || t.bet_id === f.linked_id || t.campaign_id === f.linked_id);
    const counts = { total: rows.length, todo: rows.filter((t) => t.status === 'todo').length, in_progress: rows.filter((t) => t.status === 'in_progress').length, blocked: rows.filter((t) => t.status === 'blocked').length, done: rows.filter((t) => t.status === 'done').length, overdue: rows.filter((t) => t.overdue).length };
    return { as_of: snap.asOf, counts, tasks: rows.sort((a, b) => (a.due_date || '9').localeCompare(b.due_date || '9')).map((t) => ({ task_id: t.task_id, title: t.title, owner: t.owner, due_date: t.due_date, status: t.status, priority: t.priority, overdue: t.overdue, linked: t.linked_label || t.linked_id || null, source: t.source })) };
  }

  // ---------- plan layer (Delhi 2027 workspace) ----------
  function weekOf(plan, date) { return Math.floor(daysBetween(plan.week1_start, date) / 7) + 1; }
  function weekEnd(plan, w) { return addDays(plan.week1_start, w * 7 - 1); }

  function planStatus(snap) {
    const ws = snap.ws; const plan = ws.plan;
    if (!plan) return { available: false, note: 'This workspace has no plan layer (bets, inventory, payment terms, hours or budgets). Those exist only in the Delhi 2027 live-plan workspace.' };
    const week = weekOf(plan, snap.asOf);
    const deals = snap.opps;
    const byBet = groupBy(deals, (o) => o.bet_id || 'none');
    const collect = ws.settings.collection_rate;
    const bets = plan.bets.map((b) => {
      const d = byBet[b.bet_id] || [];
      const signed = d.filter((o) => o.stage === 'partner_confirmed');
      const signedValue = sum(signed, (o) => o.confirmed_value_inr);
      const proposals = d.filter((o) => o.reached_proposal).length;
      const budget = b.acq_budget_inr + (b.fulfil_quote_inr ?? b.fulfil_budget_inr);
      const cashExp = signedValue * collect;
      const planCash = b.plan_signed_inr * collect;
      const res = {
        bet_id: b.bet_id, name: b.name, rank: b.rank, owner: b.owner_name, status: b.status,
        plan_signed_inr: b.plan_signed_inr, plan_cash_inr: round(planCash, 0), signed_inr: signedValue, signed_count: signed.length, proposals, open_deals: d.filter((o) => o.is_open).length,
        open_pipeline_inr: sum(d.filter((o) => o.is_open), (o) => o.proposed_value_inr),
        acq_budget_inr: b.acq_budget_inr, fulfil_budget_inr: b.fulfil_budget_inr, fulfil_quote_inr: b.fulfil_quote_inr ?? null, total_cost_inr: budget, spend_to_date_inr: b.spend_inr || 0,
        hours_planned: b.hours_planned, hours_logged: b.hours_logged ?? null,
        plan_cash_per_rupee: round(planCash / (b.acq_budget_inr + b.fulfil_budget_inr), 1),
        current_cash_per_rupee_at_plan_value: round(planCash / budget, 1),
        plan_cash_per_hour_inr: round(planCash / b.hours_planned, 0),
        validated_cash_per_hour_inr: b.hours_logged ? round(cashExp / b.hours_logged, 0) : null,
        signals: b.signals || {},
      };
      res.gate = evaluateGate(b, res, week, plan);
      return res;
    });
    // cash path
    const signedAll = sum(deals.filter((o) => o.stage === 'partner_confirmed' && o.support_type === 'cash'), (o) => o.confirmed_value_inr);
    const received = sum(snap.payments.filter((p) => p.paid_as_of), (p) => p.amount_inr);
    const dueToDate = sum(snap.payments.filter((p) => p.due_date && p.due_date <= snap.asOf), (p) => p.amount_inr);
    const checkpoints = plan.cash_path.map((c) => {
      const end = weekEnd(plan, c.week);
      const passed = end <= snap.asOf;
      const sn = passed ? snapshot(ws, end) : null;
      const sAt = sn ? sum(sn.opps.filter((o) => o.stage === 'partner_confirmed' && o.support_type === 'cash'), (o) => o.confirmed_value_inr) : null;
      const rAt = sn ? sum(sn.payments.filter((p) => p.paid_as_of), (p) => p.amount_inr) : null;
      let band = null;
      if (passed) {
        if (c.received_green_inr != null) band = rAt >= c.received_green_inr ? 'green' : rAt >= c.received_red_below_inr ? 'amber' : 'red';
        else if (c.signed_floor_inr != null) band = sAt >= c.signed_floor_inr ? 'green' : sAt >= 0.85 * c.signed_floor_inr ? 'amber' : 'red';
      }
      return Object.assign({}, c, { week_end: end, t_minus: daysBetween(end, ws.event.event_starts_at), passed, signed_at_checkpoint_inr: sAt, received_at_checkpoint_inr: rAt, band });
    });
    const next = checkpoints.find((c) => !c.passed);
    const props = plan.properties.map((p) => {
      const d = deals.filter((o) => o.property_id === p.property_id);
      const sold = d.find((o) => o.stage === 'partner_confirmed');
      const reserved = d.find((o) => o.is_open && o.reached_proposal);
      return Object.assign({}, p, { status: sold ? 'sold' : reserved ? 'reserved' : 'open', deal_brand: (sold || reserved || {}).brand_name || null, deal_value_inr: (sold || reserved || {}).proposed_value_inr || null });
    });
    const inv = groupBy(props, (p) => p.tier);
    const route = campaignKpis(snap).map((c) => ({ route: c.campaign_name, plan: c.plan, actual: { accounts: c.brands_reached, conversations: c.responding_brands, proposals: c.proposals, wins: c.confirmed, signed_inr: c.confirmed_value_inr } }));
    const hoursLogged = sum(plan.bets, (b) => b.hours_logged || 0);
    return {
      available: true, as_of: snap.asOf, campaign_week: week, weeks_total: plan.weeks_total, t_minus_days: daysBetween(snap.cutoff, ws.event.event_starts_at),
      targets: { base_signed_inr: plan.base_signed_inr, base_cash_inr: plan.base_signed_inr * collect, stretch_signed_inr: plan.stretch_signed_inr, collection_rate: collect, collection_rate_basis: 'ASSUMPTION (Task 1: 85% base, 90% stretch, 75% downside)' },
      actuals: { signed_cash_inr: signedAll, received_inr: received, contractually_due_to_date_inr: dueToDate, overdue_inr: sum(snap.payments.filter((p) => p.overdue_as_of), (p) => p.amount_inr),
        signed_pct_of_base: pct(signedAll, plan.base_signed_inr), projected_cash_on_signed_inr: round(signedAll * collect, 0) },
      cash_path: checkpoints, next_checkpoint: next || null,
      bets, routes: route,
      inventory: { properties: props, by_tier: Object.fromEntries(Object.entries(inv).map(([k, v]) => [k, { total: v.length, sold: v.filter((p) => p.status === 'sold').length, reserved: v.filter((p) => p.status === 'reserved').length, open: v.filter((p) => p.status === 'open').length, list_value_inr: sum(v, (p) => p.list_price_inr) }])) },
      capacity: { hours_total: plan.hours_total, hours_planned_bets: sum(plan.bets, (b) => b.hours_planned), hours_logged_bets: hoursLogged, contingency_inr: plan.contingency_inr },
      budget: { acquisition_inr: sum(plan.bets, (b) => b.acq_budget_inr), fulfilment_plan_inr: sum(plan.bets, (b) => b.fulfil_budget_inr), fulfilment_current_inr: sum(plan.bets, (b) => b.fulfil_quote_inr ?? b.fulfil_budget_inr), spend_to_date_inr: sum(plan.bets, (b) => b.spend_inr || 0), contingency_inr: plan.contingency_inr },
    };
  }

  function evaluateGate(b, r, week, plan) {
    const sg = b.signals || {}; const g = b.gate || {};
    const L = (x) => '₹' + lakh(x) + 'L';
    const out = (state, reason, action) => ({ state, reason, action: action || g.action || null, rule: g.text || null });
    switch (b.gate_type) {
      case 'title': {
        const propWeek = sg.proposal_week;
        if (r.signed_count > 0) return out('scale', `Title signed (${L(r.signed_inr)}).`, 'Deliver; pitch leftover rights as signature packages.');
        if (week > g.stop_week) return out('stop', `No signature by end of week ${g.stop_week}.`, 'Split the title into two signature packages.');
        if (!propWeek && week > g.change_week) return out('change', `No proposal by end of week ${g.change_week}.`);
        if (propWeek && propWeek <= g.proposal_week) return out('on_track', `${sg.qualified_buyers ?? '?'} qualified buyers; proposal out in week ${propWeek}; signature due by end of week ${g.sign_week}.`, 'Close by week ' + g.sign_week + '; prepare the two-signature fallback.');
        return out('watch', 'Proposal not yet sent.');
      }
      case 'talent': {
        const calls = sg.qualified_calls;
        if (calls == null) return out('no_data', 'Qualified calls not logged.');
        if (week >= g.calls_week && calls < g.stop_calls_below) return out('stop', `${calls} qualified calls by week ${g.calls_week} (stop below ${g.stop_calls_below}).`);
        if (calls >= g.scale_calls && r.signed_inr >= g.scale_signed_inr) return out('scale', `${calls} calls and ${L(r.signed_inr)} signed.`);
        if (week >= g.calls_week && calls < g.scale_calls) return out('change', `${calls} qualified calls (scale needs ${g.scale_calls}).`);
        return out('on_track', `${calls} qualified calls; ${L(r.signed_inr)} of ${L(g.scale_signed_inr)} signed (needed by end of week ${g.signed_week}).`, `Convert the ${r.proposals - r.signed_count} open proposals before week ${g.signed_week}.`);
      }
      case 'comfort': {
        const q = b.fulfil_quote_inr;
        if (q == null) return week > g.quote_week ? out('change', `Delivery quote overdue (due week ${g.quote_week}).`) : out('watch', 'Awaiting delivery quote.');
        if (q > g.stop_quote_above_inr) return out('stop', `Quote ${L(q)} is above the ${L(g.stop_quote_above_inr)} cap (${pct(q, g.reference_price_inr)}% of the ${L(g.reference_price_inr)} price).`, 'Shrink scope; keep safety funded but unsponsored.');
        if (q > g.scale_quote_max_inr) return out('change', `Quote ${L(q)} is between ${L(g.scale_quote_max_inr)} and ${L(g.stop_quote_above_inr)}: fund the gap from contingency.`);
        if (week >= g.proposal_week && r.proposals === 0) return out('stop', `No proposal out by week ${g.proposal_week}.`);
        return r.proposals >= g.scale_proposals ? out('scale', `Quote ${L(q)} within cap and ${r.proposals} proposals.`) : out('on_track', `Quote ${L(q)} within cap; ${r.proposals} proposals (scale needs ${g.scale_proposals} by week ${g.proposal_week}).`);
      }
      case 'creator': {
        if (sg.sample_reviewed && sg.rights_cleared === false) return out('change', `Buyer reviewed the sample but music and likeness rights are not cleared; ${r.proposals} proposals.`, 'Re-scope to owned assets only until rights clear.');
        if (week >= g.proposal_week && r.proposals === 0) return out('stop', `No proposal out by week ${g.proposal_week}.`);
        if (sg.sample_reviewed && r.proposals >= g.scale_proposals) return out('scale', `Sample praised and ${r.proposals} proposals.`);
        return out('watch', `Sample ${sg.sample_reviewed ? 'reviewed' : 'not yet reviewed'}; ${r.proposals} proposals.`);
      }
      case 'circuit': {
        const s = sg.societies_committed;
        if (s == null) return out('no_data', 'Society commitments not logged.');
        if (week >= g.societies_week && s <= 1) return out('stop', `${s} society committed by week ${g.societies_week}.`, 'Run the host campus only.');
        if (week >= g.societies_week && s === 2) return out('change', `Exactly 2 societies by week ${g.societies_week} (scale needs 3).`, 'Recruit a third society this week or cut to the host campus plus one.');
        if (s >= 3 && r.signed_inr >= g.scale_signed_inr) return out('scale', `${s} societies and ${L(r.signed_inr)} signed.`);
        return out('on_track', `${s} societies; ${L(r.signed_inr)} of ${L(g.scale_signed_inr)} signed (by week ${g.signed_week}).`);
      }
      case 'trail': {
        if (sg.rehearsal_passed === false) return out('stop', 'Rehearsal failed or consent unworkable.', 'Drop; move the hours to the best validated bet.');
        if (sg.rehearsal_passed === true) return out('scale', 'Rehearsal met throughput with consent.');
        return out('watch', `Rehearsal ${sg.rehearsal_date ? 'scheduled for ' + sg.rehearsal_date : 'not scheduled'}; no proposals until it passes.`);
      }
      default: return out('watch', 'No gate rule.');
    }
  }

  // Scenario on the Task 1 plan and on the live pipeline
  function scenario(snap, opts = {}) {
    const ws = snap.ws; const plan = ws.plan;
    if (!plan) return { available: false, note: 'Scenarios need the plan layer (bets, inventory, payment terms), which only the Delhi 2027 workspace has. For this dataset use get_forecast.' };
    const rate = opts.collection_rate != null ? Number(opts.collection_rate) : ws.settings.collection_rate;
    const exTiers = (opts.exclude_tiers || []).map(String);
    const exBets = (opts.exclude_bets || []).map(String);
    const planDeals = plan.plan_deals.filter((d) => !exTiers.includes(d.tier) && !exBets.includes(d.bet_id));
    const added = (opts.add_deals || []).map((d) => ({ tier: d.tier || 'custom', bet_id: d.bet_id || null, value_inr: Number(d.value_inr) }));
    const signed = sum(planDeals, (d) => d.value_inr) + sum(added, (d) => d.value_inr);
    const res = {
      basis: 'CALC on the Task 1 base plan (18 planned properties, ₹24.0L signed) with the changes below; collection rate is an ASSUMPTION.',
      changes: { excluded_tiers: exTiers, excluded_bets: exBets, added_deals: added, collection_rate: rate },
      plan_deals: planDeals.length + added.length, plan_signed_inr: signed, plan_cash_inr: round(signed * rate, 0),
      vs_base: { signed_delta_inr: signed - plan.base_signed_inr, cash_delta_inr: round(signed * rate - plan.base_signed_inr * ws.settings.collection_rate, 0) },
      vs_last_year_confirmed_cash_inr: plan.last_year_confirmed_cash_inr, uplift_on_last_year_cash_pct: round(100 * (signed * rate / plan.last_year_confirmed_cash_inr - 1), 1),
    };
    // live view: signed so far + open pipeline weighted, with same exclusions
    const wr = stageWinRates(snap);
    const open = snap.opps.filter((o) => o.is_open && !exBets.includes(o.bet_id) && !exTiers.includes(((plan.properties.find((p) => p.property_id === o.property_id)) || {}).tier));
    const signedNow = sum(snap.opps.filter((o) => o.stage === 'partner_confirmed' && o.support_type === 'cash'), (o) => o.confirmed_value_inr);
    const weighted = sum(open, (o) => o.proposed_value_inr * wr.pFor(o));
    res.live = { signed_to_date_inr: signedNow, weighted_open_pipeline_inr: round(weighted, 0), projected_signed_from_pipeline_inr: round(signedNow + weighted, 0), projected_cash_inr: round((signedNow + weighted) * rate, 0), win_rate_basis: wr.basis,
      note: 'Pipeline projection counts only deals already opened; the plan figure assumes the remaining planned properties are sold.' };
    return res;
  }

  function forecast(snap, opts = {}) {
    const wr = stageWinRates(snap);
    const ov = opts.win_prob_overrides || {};
    const ex = new Set((opts.exclude_opportunities || []).map((x) => String(x).toLowerCase()));
    const ev = snap.ws.event || {};
    const eventPassed = ev.event_starts_at && snap.cutoff >= ev.event_starts_at;
    const open = snap.opps.filter((o) => o.is_open && !ex.has(o.opportunity_id.toLowerCase()) && !ex.has((o.brand_name || '').toLowerCase()));
    const conf = snap.opps.filter((o) => o.stage === 'partner_confirmed');
    const rows = open.map((o) => {
      const p = eventPassed ? 0 : (ov[o.stage] ?? wr.pFor(o));
      return { brand: o.brand_name, opportunity_id: o.opportunity_id, campaign: o.campaign_name, stage: o.stage_label, days_in_stage: o.days_in_stage, idle: !!(wr.idle && o.days_in_stage > wr.idle.threshold_days), value_inr: o.proposed_value_inr, p: round(p, 3), expected_inr: round(o.proposed_value_inr * p, 0) };
    });
    const t = snap.targets || {};
    const expCount = sum(rows, (r) => r.p);
    const cv = sum(conf, (o) => o.confirmed_value_inr);
    return {
      as_of: snap.asOf, method: 'confirmed to date + Σ(open deal value × win probability for its stage and originating campaign)',
      win_rate_basis: eventPassed ? 'The event has started, so open deals can no longer close for it; projection = confirmed.' : wr.basis,
      idle_rule: wr.idle || null,
      overall_stage_win_rates: Object.fromEntries(Object.entries(wr.rates).map(([k, v]) => [k, v.p])), overrides: ov,
      confirmed_count: conf.length, confirmed_value_inr: cv,
      open_deals: rows.length, open_value_inr: sum(rows, (r) => r.value_inr), expected_additional_deals: round(expCount, 1), expected_additional_value_inr: round(sum(rows, (r) => r.expected_inr), 0),
      projected_confirmed_count: round(conf.length + expCount, 1), projected_confirmed_value_inr: round(cv + sum(rows, (r) => r.expected_inr), 0),
      target_confirmed_partnerships: t.confirmed_partnerships_goal ?? null, projected_gap_to_target: t.confirmed_partnerships_goal != null ? round(t.confirmed_partnerships_goal - (conf.length + expCount), 1) : null,
      excluded: Array.from(ex), deals: rows.sort((a, b) => b.expected_inr - a.expected_inr).slice(0, 25),
      caveat: 'Probabilities come from closed deals only and ignore timing; deals idle for weeks are less likely than the stage rate suggests.',
    };
  }

  // Generic query for unfamiliar questions
  const TABLES = {
    brands: (sn) => sn.brands,
    contacts: (sn) => sn.contacts,
    campaigns: (sn) => sn.ws.campaigns,
    interactions: (sn) => sn.interactions,
    qualification_latest: (sn) => Object.values(sn.qualLatest),
    qualification_history: (sn) => sn.ws.qualification.filter((q) => q.effective_at <= sn.cutoff),
    opportunities: (sn) => sn.opps.map((o) => { const x = Object.assign({}, o); delete x.ws; return x; }),
    opportunity_history: (sn) => sn.ws.opp_history.filter((h) => h.effective_at <= sn.cutoff),
    activations: (sn) => (sn.ws.activations || []).filter((a) => a.linked_at <= sn.cutoff),
    targets: (sn) => sn.ws.targets.filter((t) => t.effective_at <= sn.cutoff),
    tasks: (sn) => sn.ws.tasks,
    payments: (sn) => sn.payments,
    bets: (sn) => (sn.ws.plan ? sn.ws.plan.bets : []),
    properties: (sn) => (sn.ws.plan ? sn.ws.plan.properties : []),
  };
  function query(snap, q) {
    const fn = TABLES[q.table];
    if (!fn) throw new Error('Unknown table. Use one of: ' + Object.keys(TABLES).join(', '));
    let rows = fn(snap);
    const fields = rows.length ? Object.keys(rows[0]) : [];
    for (const f of q.filters || []) {
      if (rows.length && !(f.field in rows[0]) && !rows.some((r) => f.field in r)) throw new Error(`Field "${f.field}" does not exist in ${q.table}. Fields: ${fields.join(', ')}`);
      const raw = f.value; const op = f.op || 'eq';
      const v = (typeof raw === 'string' && raw.trim() !== '' && !isNaN(Number(raw)) && ['gt', 'gte', 'lt', 'lte'].includes(op)) ? Number(raw) : raw;
      const test = {
        eq: (x) => String(x).toLowerCase() === String(v).toLowerCase(), neq: (x) => String(x).toLowerCase() !== String(v).toLowerCase(),
        contains: (x) => String(x ?? '').toLowerCase().includes(String(v).toLowerCase()), in: (x) => [].concat(v).map((y) => String(y).toLowerCase()).includes(String(x).toLowerCase()),
        gt: (x) => x > v, gte: (x) => x >= v, lt: (x) => x < v, lte: (x) => x <= v, is_null: (x) => x == null || x === '', not_null: (x) => !(x == null || x === ''),
      }[op];
      if (!test) throw new Error('Unknown op ' + op);
      rows = rows.filter((r) => test(r[f.field]));
    }
    const agg = q.aggregate || 'count';
    if (q.group_by) {
      const gs = [].concat(q.group_by);
      const groups = groupBy(rows, (r) => gs.map((g) => r[g]).join(' | '));
      const out = Object.entries(groups).map(([k, v]) => ({ group: k, value: aggregate(v, agg, q.field) }));
      out.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
      return { table: q.table, as_of: snap.asOf, matched_rows: rows.length, group_by: gs, aggregate: agg, field: q.field || null, groups: out.slice(0, q.limit || 50), truncated: out.length > (q.limit || 50) };
    }
    if (q.aggregate) return { table: q.table, as_of: snap.asOf, matched_rows: rows.length, aggregate: agg, field: q.field || null, value: aggregate(rows, agg, q.field) };
    const lim = Math.min(q.limit || 25, 60);
    const pick = q.fields ? rows.map((r) => Object.fromEntries(q.fields.map((f) => [f, r[f]]))) : rows.map((r) => { const x = Object.assign({}, r); delete x._edit; delete x.ws; delete x.summary; return x; });
    return { table: q.table, as_of: snap.asOf, matched_rows: rows.length, rows: pick.slice(0, lim), truncated: rows.length > lim, available_fields: fields };
  }
  function aggregate(rows, agg, field) {
    if (agg === 'count') return rows.length;
    if (!field) throw new Error('aggregate ' + agg + ' needs "field"');
    if (agg === 'count_distinct') return uniq(rows.map((r) => r[field])).length;
    const nums = rows.map((r) => Number(r[field])).filter((x) => isFinite(x));
    if (agg === 'sum') return sum(nums);
    if (agg === 'avg') return nums.length ? round(sum(nums) / nums.length, 2) : null;
    if (agg === 'min') return nums.length ? Math.min(...nums) : null;
    if (agg === 'max') return nums.length ? Math.max(...nums) : null;
    if (agg === 'median') return median(nums);
    throw new Error('Unknown aggregate ' + agg);
  }

  function dataCoverage(ws) {
    const has = (t) => (ws[t] || []).length > 0;
    return {
      workspace: ws.workspace.name, kind: ws.workspace.kind, description: ws.workspace.description,
      tables: Object.fromEntries(Object.keys(TABLES).map((t) => [t, (TABLES[t]({ ws, brands: ws.brands, contacts: ws.contacts, interactions: ws.interactions, qualLatest: {}, opps: ws.opportunities, payments: ws.payments, cutoff: '9999' }) || []).length])),
      history_window: [ws.event.history_start, ws.event.history_end || null],
      what_the_data_cannot_answer: ws.plan ? [
        'Sponsor sales or brand lift after the festival (no outcome data).', 'Attendee footfall or registrations (simulated plan only, no live attendee data).',
        'Whether a sponsor will renew next year.', 'Anything about real companies: every brand and person here is synthetic.',
      ] : [
        'Cash actually received: the dataset has confirmed values only, no invoices or bank receipts.', 'Marketing spend, budgets or cost per deal: no spend table exists (budgets can be entered on campaigns, then they are user input).',
        'Sponsor sales lift or attendee impact: activations record an association, not causal uplift.', 'Why a deal was lost: no loss-reason field.', 'Team hours or effort per campaign.',
        'Anything about real companies: brands, people and the event are fictional.',
      ],
      data_quality: ws.data_quality, edits_applied: ws.edit_count,
      definitions: {
        reached: 'brand has an outreach_sent, introduction_received or web_inbound event', responded: 'replied (except wrong_contact) or submitted the inbound form',
        qualified: 'latest qualification version ≤ as-of date is "qualified"', proposal: 'deal history reached proposal_sent or later by the as-of date', confirmed: 'latest deal stage is partner_confirmed (value is reported, not bank-verified)',
        as_of: 'end of the selected day in Asia/Kolkata; later records are ignored so nothing leaks backwards',
      },
    };
  }

  // Safe arithmetic for the AI
  function calculate(expr) {
    const s = String(expr);
    if (!/^[\d\s+\-*/().,%^eE]+$/.test(s)) throw new Error('Only numbers and + - * / ( ) % ^ are allowed');
    const js = s.replace(/,/g, '').replace(/\^/g, '**').replace(/(\d+(?:\.\d+)?)%/g, '($1/100)');
    // eslint-disable-next-line no-new-func
    const v = Function('"use strict";return (' + js + ')')();
    if (typeof v !== 'number' || !isFinite(v)) throw new Error('Result is not a finite number');
    return { expression: s, result: Math.round(v * 1e6) / 1e6 };
  }

  return { STAGES, OPEN_STAGES, QUAL_STATUSES, materialize, snapshot, overview, funnel, campaignKpis, listOpportunities, bottlenecks, weeklySeries, brandDetail, tasksView, planStatus, scenario, forecast, query, dataCoverage, calculate, stageWinRates, newId, lakh, round, pct, daysBetween, addDays, dateOf, weekOf, weekEnd, sum };
});
