/* Sponsor Growth Center: dashboard + management tool. */
(function () {
  'use strict';
  const E = window.GCEngine;
  const S = window.GCStore;

  // ---------- formatting ----------
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = (x) => (x == null || isNaN(x) ? '–' : '₹' + Math.round(x).toLocaleString('en-IN'));
  const L = (x, d = 2) => (x == null || isNaN(x) ? '–' : '₹' + (+(x / 100000).toFixed(d)).toString() + 'L');
  const n = (x) => (x == null || isNaN(x) ? '–' : (+x).toLocaleString('en-IN'));
  const p = (x) => (x == null || isNaN(x) ? '–' : x + '%');
  const dshort = (s) => { if (!s) return '–'; const d = new Date(s.slice(0, 10) + 'T00:00:00Z'); return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }); };
  const label = (s) => String(s || '').replace(/_/g, ' ');
  const VERDICT_LABEL = { scale: 'Scale', keep: 'Keep', change: 'Change', stop: 'Stop', watch: 'Watch', stopped: 'Stopped', on_track: 'On track', no_data: 'No data' };
  const pill = (state, text) => `<span class="pill ${esc(state)}">${esc(text || VERDICT_LABEL[state] || label(state))}</span>`;

  // ---------- app state ----------
  const WORKSPACES = [
    { id: 'cf25', file: 'data/campusfest2025.json' },
    { id: 'dl27', file: 'data/delhi2027.json' },
  ];
  const App = window.GCApp = { bases: {}, wsId: 'cf25', asOf: null, ws: null, snap: null, view: 'overview', f: { deals: { stage: 'open', sort: 'value' }, tasks: {} }, chatOpen: false };
  const aiOn = () => !!(window.GCAI && window.GCAI.enabled && window.GCAI.enabled());
  const VIEWS = [['overview', 'Overview'], ['campaigns', 'Campaigns'], ['deals', 'Deals'], ['plan', 'Bets & cash'], ['tasks', 'Tasks'], ['data', 'Data & settings']];

  function prefs(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem('gc_pref_' + k)); localStorage.setItem('gc_pref_' + k, JSON.stringify(v)); } catch (e) { return null; } }

  App.recompute = function () {
    const base = App.bases[App.wsId];
    App.ws = E.materialize(base, S.get(App.wsId));
    App.snap = E.snapshot(App.ws, App.asOf);
  };
  App.edit = async function (type, payload, opts = {}) {
    const e = { id: E.newId('e'), at: new Date().toISOString(), effective_at: App.asOf + 'T20:00:00', type, payload, source: opts.source || 'user', actor: opts.actor || null };
    // validate before persisting
    try { const ws = E.materialize(App.bases[App.wsId], [...S.get(App.wsId), e]); const mine = ws.change_log.find((c) => c.id === e.id) || ws.change_log[ws.change_log.length - 1]; if (mine && mine.error) throw new Error(mine.error); }
    catch (err) { toast('Not saved: ' + err.message); return { ok: false, error: err.message }; }
    const r = await S.add(App.wsId, e);
    if (!r.ok) toast(r.error); else if (!opts.silent) toast(opts.toast || 'Saved', e.id);
    return Object.assign({ edit: e }, r);
  };
  App.setWorkspace = function (id) {
    App.wsId = id; prefs('ws', id);
    App.asOf = App.bases[id].workspace.default_as_of; App.recompute(); render();
    window.GCAI && window.GCAI.onWorkspaceChange && window.GCAI.onWorkspaceChange();
  };
  App.go = function (view) { if (location.hash !== '#' + view) location.hash = view; else { App.view = view; render(); } };

  // ---------- toast + tooltip ----------
  let toastTimer;
  // Feedback for every action; edits get an Undo button (people make mistakes, so make them cheap to reverse).
  function toast(msg, undoId) {
    let t = document.getElementById('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.innerHTML = `<span>${esc(msg)}</span>${undoId ? `<button class="toast-undo" data-action="undo" data-id="${esc(undoId)}">Undo</button>` : ''}`;
    t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, undoId ? 7000 : 2600);
  }
  App.toast = toast;
  const tipEl = () => { let t = document.getElementById('tip'); if (!t) { t = document.createElement('div'); t.id = 'tip'; t.className = 'tip'; t.hidden = true; document.body.appendChild(t); } return t; };
  document.addEventListener('mousemove', (ev) => {
    const el = ev.target.closest && ev.target.closest('[data-tip]');
    const t = tipEl();
    if (!el) { t.hidden = true; return; }
    t.textContent = el.getAttribute('data-tip'); t.hidden = false;
    const x = Math.min(ev.clientX + 14, window.innerWidth - t.offsetWidth - 8); t.style.left = x + 'px'; t.style.top = (ev.clientY + 14) + 'px';
  });

  // ---------- charts (inline SVG) ----------
  function funnelChart(stages) {
    const W = 640, rowH = 34, padL = 210, padR = 90, H = stages.length * rowH + 8;
    const max = Math.max(...stages.map((s) => s.value), 1);
    const rows = stages.map((s, i) => {
      const w = Math.max(2, ((W - padL - padR) * s.value) / max); const y = i * rowH + 4;
      const color = s.unit === 'opportunity' ? 'var(--series-2)' : 'var(--series-1)';
      const tip = `${s.label}: ${s.value} ${s.unit === 'opportunity' ? 'deals' : 'brands'}${s.conv_from_prev_pct != null ? ' · ' + s.conv_from_prev_pct + '% of previous stage' : ''}`;
      return `<g data-tip="${esc(tip)}"><rect x="0" y="${y}" width="${W}" height="${rowH - 4}" fill="transparent"/>
        <text class="lbl" x="${padL - 10}" y="${y + 19}" text-anchor="end">${esc(s.label)}</text>
        <rect x="${padL}" y="${y + 6}" width="${w}" height="${rowH - 16}" rx="3" fill="${color}"/>
        <text class="val" x="${padL + w + 6}" y="${y + 19}">${s.value}${s.conv_from_prev_pct != null ? ` <tspan fill="var(--ink-3)">· ${s.conv_from_prev_pct}%</tspan>` : ''}</text></g>`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sponsor funnel">${rows}</svg>
      <div class="legend"><span><i style="background:var(--series-1)"></i>Brands</span><span><i style="background:var(--series-2)"></i>Deals (opportunities)</span></div>`;
  }

  function lineChart(rows, series, opts = {}) {
    const W = 640, H = 230, pl = 52, pr = 16, pt = 12, pb = 28;
    const xs = rows.map((r, i) => pl + (rows.length > 1 ? (i * (W - pl - pr)) / (rows.length - 1) : (W - pl - pr) / 2));
    let max = 0; for (const s of series) for (const r of rows) if (r[s.key] != null) max = Math.max(max, r[s.key]);
    max = max || 1; const step = niceStep(max / 4); const top = Math.ceil(max / step) * step;
    const y = (v) => pt + (H - pt - pb) * (1 - v / top);
    let g = '';
    for (let v = 0; v <= top + 1e-9; v += step) g += `<line class="gridline" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${esc(opts.fmt ? opts.fmt(v) : v)}</text>`;
    const every = Math.ceil(rows.length / 7);
    rows.forEach((r, i) => { if (i % every === 0 || i === rows.length - 1) g += `<text x="${xs[i]}" y="${H - 8}" text-anchor="middle">${esc(dshort(r.week_ending))}</text>`; });
    let lines = '';
    series.forEach((s) => {
      const pts = rows.map((r, i) => (r[s.key] == null ? null : [xs[i], y(r[s.key])])).filter(Boolean);
      if (!pts.length) return;
      const d = (s.step ? pts.map((q, i) => (i ? `H${q[0]}V${q[1]}` : `M${q[0]},${q[1]}`)) : pts.map((q, i) => (i ? 'L' : 'M') + q[0] + ',' + q[1])).join('');
      lines += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" ${s.dash ? 'stroke-dasharray="5 4"' : ''}/>`;
      if (!s.dash) { const last = pts[pts.length - 1]; lines += `<circle cx="${last[0]}" cy="${last[1]}" r="4" fill="${s.color}" stroke="var(--panel)" stroke-width="2"/>`; }
    });
    const hits = rows.map((r, i) => {
      const tip = dshort(r.week_ending) + ': ' + series.map((s) => `${s.name} ${r[s.key] == null ? '–' : (opts.fmt ? opts.fmt(r[s.key]) : r[s.key])}`).join(' · ');
      const w = (W - pl - pr) / Math.max(rows.length - 1, 1);
      return `<rect x="${xs[i] - w / 2}" y="${pt}" width="${w}" height="${H - pt - pb}" fill="transparent" data-tip="${esc(tip)}"/>`;
    }).join('');
    const legend = series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i class="${s.dash ? 'dash' : 'line'}" style="${s.dash ? 'border-color:' + s.color : 'background:' + s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || 'Trend')}"><line class="axis" x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}"/>${g}${lines}${hits}</svg>${legend}`;
  }
  function niceStep(x) { const e = Math.pow(10, Math.floor(Math.log10(x || 1))); const f = x / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; }

  // ---------- header ----------
  function renderHeader() {
    const ws = App.ws; const ev = ws.event;
    const opts = WORKSPACES.map((w) => `<option value="${w.id}" ${w.id === App.wsId ? 'selected' : ''}>${esc(App.bases[w.id].workspace.name)}</option>`).join('');
    const min = (ev.history_start || '').slice(0, 10); const max = App.bases[App.wsId].workspace.default_as_of;
    const mode = S.mode();
    const kindTag = ws.workspace.kind === 'source' ? '<span class="tag fact">Source data</span>' : '<span class="tag sim">Simulated</span>';
    document.getElementById('top').innerHTML = `
      <div class="top-row">
        <div class="brand"><span class="brand-mark" aria-hidden="true"></span><div style="min-width:0"><h1>Sponsor Growth Center</h1><div class="sub">Challenge B · sponsorship cash · Delhi festival</div></div></div>
        <div class="controls">
          <label class="field"><span>Workspace</span><select id="ws-select" data-change="workspace">${opts}</select></label>
          <label class="field" title="Every number is recomputed from records up to the end of this day (India time). Pick an earlier date to see what you knew then."><span>Show data as of</span><input id="asof" type="date" value="${esc(App.asOf)}" min="${esc(min)}" max="${esc(max)}" data-change="asof"></label>
          <button class="btn sm" data-action="asof-latest" title="Jump to the latest date in this workspace">Latest</button>
        </div>
      </div>
      <nav class="tabs" aria-label="Sections">${VIEWS.map(([k, t]) => `<a href="#${k}" ${App.view === k ? 'aria-current="page"' : ''}>${t}</a>`).join('')}<span class="spacer"></span>
        <button class="btn sm ghost" data-action="guide-open" title="Show the three-step guide again">Guide</button>
        ${aiOn() ? `<button class="btn sm ghost" data-action="toggle-chat" aria-pressed="${App.chatOpen}">${App.chatOpen ? 'Hide analyst' : 'Ask the analyst'}</button>` : '<button class="btn sm ghost" data-action="ai-setup" title="Optional: add your own Gemini, Claude or OpenAI key">Add AI analyst</button>'}</nav>
      <div class="banner">${kindTag}<span title="${esc(ws.workspace.description)}">${ws.workspace.kind === 'source' ? 'The original sponsor dataset from the assignment (Jan to Apr 2025). Numbers are facts from it unless tagged.' : 'A simulated week 4 of the Delhi 2027 plan. Plan figures come from Task 1; deals, people and brands are invented.'}</span><span class="pill ${mode === 'memory' ? 'warn' : 'neutral'}" title="${esc(S.note())}">${mode === 'memory' ? 'Not saved: storage blocked' : 'Saved in this browser'}</span>${ws.edit_count ? `<span class="muted small">${ws.edit_count} change${ws.edit_count > 1 ? 's' : ''} applied on top of the original data</span>` : ''}</div>`;
    document.documentElement.style.setProperty('--top-h', document.getElementById('top').offsetHeight + 'px');
  }

  // ---------- OVERVIEW ----------
  function kpi(title, value, sub, meterPct, meterCls, tag) {
    return `<div class="card kpi"><div class="eyebrow">${esc(title)} ${tag || ''}</div><div class="v${/^[A-Za-z]/.test(String(value)) && !/^Week/.test(String(value)) ? ' text' : ''}">${value}</div>${meterPct != null ? `<div class="meter ${meterCls || ''}"><i style="width:${Math.max(0, Math.min(100, meterPct))}%"></i></div>` : ''}<div class="d">${sub}</div></div>`;
  }
  function attentionItems() {
    const sn = App.snap; const items = [];
    const camps = E.campaignKpis(sn);
    for (const c of camps.filter((c) => ['stop', 'change'].includes(c.verdict))) items.push({ sev: c.verdict === 'stop' ? 'stop' : 'change', title: `${c.campaign_name}: ${VERDICT_LABEL[c.verdict].toLowerCase()}`, why: c.verdict_reason, task: { title: `${c.verdict === 'stop' ? 'Decide whether to stop' : 'Fix conversion on'} ${c.campaign_name}`, owner: c.owner_name, linked_type: 'campaign', linked_id: c.sponsor_campaign_id, linked_label: c.campaign_name } });
    if (sn.ws.plan) {
      const ps = E.planStatus(sn);
      for (const b of ps.bets.filter((b) => ['stop', 'change'].includes(b.gate.state))) items.push({ sev: b.gate.state, title: `${b.name}: gate says ${VERDICT_LABEL[b.gate.state].toLowerCase()}`, why: b.gate.reason + (b.gate.action ? ' Action: ' + b.gate.action : ''), task: { title: `${b.name}: ${b.gate.action || 'act on gate'}`, owner: b.owner, linked_type: 'bet', linked_id: b.bet_id, linked_label: b.name } });
      const cp = ps.cash_path.filter((c) => c.passed).pop();
      if (cp && cp.band !== 'green') items.push({ sev: cp.band === 'red' ? 'stop' : 'change', title: `Cash path ${cp.label}: ${cp.band}`, why: `Signed ${L(cp.signed_at_checkpoint_inr)} against a ${L(cp.signed_floor_inr)} floor.`, task: { title: 'Recover the cash path: shift hours to the best validated bet', owner: 'Aanya Mehra', linked_type: null } });
      if (ps.actuals.overdue_inr > 0) items.push({ sev: 'stop', title: `Overdue invoices: ${L(ps.actuals.overdue_inr)}`, why: 'An invoice is past its due date (risk trigger: more than 7 days overdue escalates).', task: { title: 'Chase overdue sponsor invoices', owner: 'Sara Khan', linked_type: null } });
    }
    const bn = E.bottlenecks(sn);
    const stale = bn.find((b) => b.type === 'stale_open_deals');
    if (stale && stale.count) items.push({ sev: 'change', title: `${stale.count} open deals idle ${stale.threshold_days}+ days (${L(stale.value_inr)})`, why: 'Oldest: ' + stale.deals.slice(0, 3).map((d) => `${d.brand} (${d.stage}, ${d.days}d)`).join(', '), task: { title: `Review ${stale.count} idle deals: close out or re-engage`, owner: stale.deals[0] && stale.deals[0].owner, linked_type: null } });
    const met = bn.find((b) => b.type === 'meeting_held_but_no_deal');
    if (met && met.count) items.push({ sev: 'watch', title: `${met.count} brands met but no deal opened`, why: met.brands.slice(0, 5).join(', ') + (met.count > 5 ? '…' : ''), task: { title: `Open deals or disqualify ${met.count} brands that already met`, linked_type: null } });
    const tv = E.tasksView(sn, { overdue_only: true });
    if (tv.counts.overdue) items.push({ sev: 'stop', title: `${tv.counts.overdue} overdue task${tv.counts.overdue > 1 ? 's' : ''}`, why: tv.tasks.slice(0, 3).map((t) => `${t.title} (${t.owner}, due ${dshort(t.due_date)})`).join('; '), go: 'tasks' });
    const order = { stop: 0, change: 1, watch: 2 };
    return items.sort((a, b) => order[a.sev] - order[b.sev]);
  }

  // Top task first (McGovern, Krug): one sentence that answers "are we on track, and what do I do next?"
  function briefing(sn, o, fc, plan, items) {
    let status, headline, detail, metric, ask;
    if (plan) {
      const cp = plan.cash_path.filter((c) => c.passed).pop(); const nx = plan.next_checkpoint;
      const band = cp ? cp.band : 'green';
      status = band === 'green' ? 'good' : band === 'amber' ? 'warn' : 'bad';
      headline = band === 'green' ? 'On track for the ₹20.4L cash goal' : band === 'amber' ? 'Slightly behind plan' : 'Behind plan: act this week';
      detail = cp ? `${L(cp.signed_at_checkpoint_inr)} signed against the ${L(cp.signed_floor_inr, 1)} needed by ${cp.label.toLowerCase()}.` : '';
      if (nx) detail += ` Next checkpoint: ${L(nx.signed_floor_inr, 1)} signed by ${dshort(nx.week_end)} (T−${nx.t_minus}).`;
      detail += ` Week ${plan.campaign_week} of ${plan.weeks_total}, ${o.days_to_event} days to the festival.`;
      metric = { label: 'Signed toward the ₹24L plan', pct: plan.actuals.signed_pct_of_base, text: `${L(plan.actuals.signed_cash_inr)} of ${L(plan.targets.base_signed_inr, 1)}` };
      ask = 'Why is cash behind plan this week, and what should we do first?';
    } else {
      const t = o.targets || {}; const goal = t.confirmed_partnerships_goal; const got = o.confirmed.count;
      const camps = E.campaignKpis(sn);
      const winners = camps.filter((c) => c.confirmed > 0).sort((a, b) => b.confirmed - a.confirmed);
      const zero = camps.filter((c) => c.confirmed === 0 && c.attempts >= 30);
      if (o.days_to_event < 0) { status = got >= goal ? 'good' : 'warn'; headline = `Festival over: ${got} of ${goal} partnerships confirmed (${t.confirmed_partnerships_attainment_pct}% of goal)`; }
      else { const pr = fc.projected_confirmed_count; status = pr >= goal ? 'good' : pr >= 0.85 * goal ? 'warn' : 'bad'; headline = `${pr >= goal ? 'On track' : 'At risk'}: projected ${pr} of ${goal} partnerships (${got} confirmed so far)`; }
      detail = winners.length ? `Wins came from ${winners.slice(0, 3).map((c) => `${c.campaign_name} (${c.confirmed})`).join(', ')}.` : 'No wins yet.';
      const names = zero.map((c) => c.campaign_name); if (zero.length) detail += ` ${names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0]} won nothing from ${zero.reduce((s, c) => s + c.attempts, 0)} attempts.`;
      if (o.days_to_event >= 0) detail += ` ${o.days_to_event} days to the festival.`;
      metric = { label: 'Confirmed toward the goal', pct: t.confirmed_partnerships_attainment_pct, text: `${got} of ${goal ?? '–'}` };
      ask = 'Why did we miss the confirmed partnerships target, and what should we do differently next time?';
    }
    const top = items.slice(0, 3);
    return `<section class="card brief ${status}" aria-label="Briefing">
      <div class="brief-main"><div class="eyebrow">Where we stand · ${dshort(App.asOf)} ${App.asOf.slice(0, 4)}</div>
        <h2 class="brief-h">${esc(headline)}</h2><p class="brief-d">${esc(detail)}</p>
        <div class="brief-metric"><div class="meter ${status === 'good' ? 'good' : ''}"><i style="width:${Math.max(0, Math.min(100, metric.pct || 0))}%"></i></div><span><b>${esc(metric.text)}</b> · ${esc(metric.label)}</span></div>
        ${aiOn() ? `<button class="btn sm" data-action="ask" data-q="${esc(ask)}">Ask the analyst why</button>` : ''}</div>
      <div class="brief-next"><div class="eyebrow">Do next</div>
        ${top.length ? `<ol>${top.map((it, i) => `<li>${pill(it.sev)}<span><strong>${esc(it.title)}</strong></span>${it.task ? `<button class="btn sm" data-action="task-from-alert" data-i="${i}">Create task</button>` : `<button class="btn sm" data-action="go" data-view="${it.go}">Open</button>`}</li>`).join('')}</ol>` : '<p class="muted">Nothing needs action at this date.</p>'}
      </div></section>`;
  }
  // First-visit guide (Krug: make the first three things obvious); dismissible, reopen from "Guide".
  function guide() {
    if (prefs('guide_done')) return '';
    return `<section class="card guide" aria-label="Getting started"><div><div class="eyebrow">New here? Try these three things</div>
      <ol><li><b>Read the briefing below.</b> It says whether we are on track and the three things to do next.</li>
      <li><b>Change something.</b> Move a deal's stage in <a href="#deals">Deals</a> or a card in <a href="#tasks">Tasks</a>. Every number updates, and you can undo from the message that appears.</li>
      ${aiOn() ? '<li><b>Ask the analyst.</b> Try <a href="#" data-action="ask" data-q="Which campaigns should we stop, and why? Show the numbers.">"Which campaigns should we stop?"</a> It answers from this data and drafts tasks for you to confirm.</li>' : '<li><b>Optional: add an AI analyst.</b> With your own Gemini, Claude or OpenAI key (<a href="#" data-action="ai-setup">Add AI analyst</a>), a panel answers questions from this data and drafts tasks for you to confirm. Everything else works without it.</li>'}</ol>
      <p class="muted small">${App.wsId === 'cf25' ? '<a href="#" data-action="switch-ws" data-id="dl27">Switch to the Delhi 2027 plan</a> to see the Task 1 strategy running in week 4.' : '<a href="#" data-action="switch-ws" data-id="cf25">Switch to CampusFest 2025</a> to see the original dataset.'} Tags: <span class="tag fact">fact</span> from the data, <span class="tag calc">calc</span> computed here, <span class="tag assumption">assumption</span> a plan input you can change.</p></div>
      <button class="btn sm" data-action="guide-close">Got it</button></section>`;
  }

  function viewOverview() {
    const sn = App.snap; const o = E.overview(sn); const t = o.targets || {}; const fc = E.forecast(sn);
    const plan = sn.ws.plan ? E.planStatus(sn) : null;
    const items = attentionItems();
    let tiles = '';
    if (plan) {
      tiles += kpi('Signed cash', L(plan.actuals.signed_cash_inr), `${p(plan.actuals.signed_pct_of_base)} of the ${L(plan.targets.base_signed_inr, 1)} base · stretch ${L(plan.targets.stretch_signed_inr, 1)}`, plan.actuals.signed_pct_of_base, plan.actuals.signed_pct_of_base < 50 ? '' : 'good', '<span class="tag calc">calc</span>');
      tiles += kpi('Cash received', L(plan.actuals.received_inr), `${L(plan.actuals.contractually_due_to_date_inr)} due so far · <b style="color:var(--bad)">${L(plan.actuals.overdue_inr)} overdue</b>`, plan.actuals.contractually_due_to_date_inr ? (100 * plan.actuals.received_inr) / plan.actuals.contractually_due_to_date_inr : null, 'bad');
      tiles += kpi('Proposals sent', n(o.opportunities_reached_proposal), `${plan.cash_path[0].proposals_floor} needed by end of week 4 · 36 by week 5 · from ${n(o.brands_responded)} conversations`, (100 * o.opportunities_reached_proposal) / 36);
      tiles += kpi('Likely to sign', L(fc.projected_confirmed_value_inr), `signed so far plus ${L(fc.open_value_inr)} open in ${fc.open_deals} deals, weighted by stage`, null, null, '<span class="tag assumption">assumption</span>');
    } else {
      const cashVals = sn.opps.filter((x) => x.stage === 'partner_confirmed' && x.support_type === 'cash').map((x) => x.confirmed_value_inr);
      tiles += kpi('Confirmed partnerships', `${o.confirmed.count}<span class="muted" style="font-size:1rem"> / ${t.confirmed_partnerships_goal ?? '–'}</span>`, `${L(o.confirmed.value_inr)} reported · ${o.confirmed.cash_count} cash (${L(o.confirmed.cash_value_inr)}, avg ${L(o.confirmed.avg_cash_deal_inr)}${cashVals.length ? `, ${L(Math.min(...cashVals))}–${L(Math.max(...cashVals))}` : ''}), ${o.confirmed.in_kind_count} in kind`, t.confirmed_partnerships_attainment_pct, t.confirmed_partnerships_attainment_pct >= 100 ? 'good' : '', '<span class="tag fact">fact</span>');
      tiles += kpi('Qualified brands', `${o.qualification.qualified}<span class="muted" style="font-size:1rem"> / ${t.qualified_brands_goal ?? '–'}</span>`, `Goal from "${esc(t.version || '')}" · ${o.qualification.engaged} engaged awaiting review`, t.qualified_brands_attainment_pct, t.qualified_brands_attainment_pct >= 100 ? 'good' : '', '<span class="tag fact">fact</span>');
      tiles += kpi('Projected confirmed', `${fc.projected_confirmed_count}`, `${L(fc.projected_confirmed_value_inr)} · ${o.days_to_event < 0 ? `event over, so the ${o.opportunities_open} open deals (${L(o.open_pipeline_inr)}) no longer count` : `confirmed plus ${o.opportunities_open} open deals (${L(o.open_pipeline_inr)}) weighted by win rate`}`, null, null, '<span class="tag calc">calc</span>');
      tiles += kpi('Cash collected', 'Not recorded', 'The dataset has confirmed values only, no invoices or receipts, so this cannot be measured', null, null, '<span class="tag">gap</span>');
    }
    const fun = E.funnel(sn).overall.stages;
    const metrics = plan ? ['confirmed_cash_value_inr', 'received_inr'] : ['confirmed_count', 'target_confirmed', 'qualified_brands', 'target_qualified'];
    const series = E.weeklySeries(sn.ws, App.asOf, metrics);
    const trend = plan
      ? lineChart(series.map((r) => Object.assign(r, { floor: floorAt(sn.ws.plan, r.week_ending) })), [{ key: 'confirmed_cash_value_inr', name: 'Signed', color: 'var(--series-1)' }, { key: 'received_inr', name: 'Received', color: 'var(--series-3)' }, { key: 'floor', name: 'Signed floor (plan)', color: 'var(--ink-3)', dash: true, step: true }], { fmt: (v) => L(v, 1), aria: 'Signed and received cash by week' })
      : lineChart(series, [{ key: 'confirmed_count', name: 'Confirmed', color: 'var(--series-1)' }, { key: 'target_confirmed', name: 'Confirmed goal', color: 'var(--series-1)', dash: true, step: true }, { key: 'qualified_brands', name: 'Qualified brands', color: 'var(--series-2)' }, { key: 'target_qualified', name: 'Qualified goal', color: 'var(--series-2)', dash: true, step: true }], { aria: 'Confirmed partnerships and qualified brands by week' });
    const camps = E.campaignKpis(sn);
    const more = items.slice(3); const shown = App.f.alertsAll ? more : [];
    return `
      ${guide()}
      ${briefing(sn, o, fc, plan, items)}
      <div class="section-head"><h2>${esc(o.event)} in numbers</h2></div>
      <div class="kpis">${tiles}</div>
      <div class="two">
        <div class="card"><header><h3>Where brands drop out</h3><span class="muted small">brands, then deals · the biggest drop is the bottleneck</span></header>${funnelChart(fun)}</div>
        <div class="card"><header><h3>${plan ? 'Signed and received cash vs the plan floor' : 'Targets vs actuals by week'}</h3><span class="muted small">hover for weekly values</span></header>${trend}</div>
      </div>
      <div class="two">
        <div class="card"><header><h3>Why these need action</h3><span class="muted small">${items.length} flagged · most urgent first</span></header>
          <div class="alerts">${[...items.slice(0, 3), ...shown].map((it, i) => `<div class="alert">${pill(it.sev)}<div><strong>${esc(it.title)}</strong><div class="why">${esc(it.why)}</div></div>${it.task ? `<button class="btn sm" data-action="task-from-alert" data-i="${i}">Create task</button>` : `<button class="btn sm" data-action="go" data-view="${it.go}">Open</button>`}</div>`).join('') || '<p class="muted">Nothing flagged at this date.</p>'}</div>
          ${more.length ? `<button class="btn sm ghost" style="margin-top:8px" data-action="alerts-all">${App.f.alertsAll ? 'Show fewer' : `Show ${more.length} more`}</button>` : ''}</div>
        <div class="card"><header><h3>Campaigns at a glance</h3><a href="#campaigns" class="small">All campaign KPIs</a></header>
          <div class="table-wrap"><table><thead><tr><th>Campaign</th><th class="num">Confirmed</th><th class="num">Value</th><th>Call</th></tr></thead><tbody>
          ${camps.map((c) => `<tr class="clickable" data-action="open-campaign" data-id="${esc(c.sponsor_campaign_id)}"><td>${esc(c.campaign_name)}<div class="cell-sub">${esc(c.channel)} · ${esc(c.owner_name || '')}</div></td><td class="num">${c.confirmed}</td><td class="num">${L(c.confirmed_value_inr)}</td><td>${pill(c.verdict)}</td></tr>`).join('')}
          </tbody></table></div></div>
      </div>`;
  }
  App._alerts = attentionItems;
  function floorAt(plan, date) {
    const wk = E.weekOf(plan, date); const r = plan.ramp.signed; const share = wk < 1 ? 0 : r[Math.min(wk, r.length) - 1];
    return Math.round(plan.base_signed_inr * share);
  }

  // ---------- CAMPAIGNS ----------
  function viewCampaigns() {
    const sn = App.snap; const camps = E.campaignKpis(sn);
    const gb = App.f.funnelBy || 'campaign';
    const fun = E.funnel(sn, gb);
    const hasPlan = !!sn.ws.plan;
    const maxV = Math.max(...camps.map((c) => c.confirmed_value_inr), 1);
    const all = !!App.f.campCols;
    return `
      <div class="section-head"><h2>Campaigns: what to scale, change or stop</h2><span class="spacer"></span><button class="btn" data-action="new-campaign">New campaign</button></div>
      <p class="lede">Each campaign gets a call with the reason behind it. Click a row to edit its owner, budget or status.</p>
      <div class="card"><header><h3>${camps.length} campaigns</h3><button class="btn sm ghost" data-action="camp-cols" aria-pressed="${!!App.f.campCols}">${App.f.campCols ? 'Show key columns' : 'Show all columns'}</button></header><div class="table-wrap"><table class="camps">
        <thead><tr><th>Campaign</th><th>Call and why</th>${all ? '<th>Status</th>' : ''}<th class="num">Attempts</th>${all ? '<th class="num">Brands reached</th><th class="num">Reply rate</th>' : ''}<th class="num">Positive replies</th>${all ? '<th class="num">Meetings</th><th class="num">Qualified</th>' : ''}<th class="num">Deals</th>${all ? '<th class="num">Proposals</th>' : ''}<th class="num">Confirmed</th><th class="num">Win rate</th><th>Confirmed value</th>${all ? '<th class="num">Avg deal</th><th class="num">Open pipeline</th><th class="num">Days to close</th>' : ''}${all || hasPlan ? '<th class="num">Budget</th>' : ''}${hasPlan ? '<th class="num">Spend</th>' : ''}</tr></thead>
        <tbody>${camps.map((c) => `<tr class="clickable" data-action="open-campaign" data-id="${esc(c.sponsor_campaign_id)}">
          <td class="name"><b>${esc(c.campaign_name)}</b><div class="cell-sub">${esc(c.channel)} · ${esc(c.owner_name || 'no owner')}${c.status !== 'active' ? ' · ' + esc(c.status) : ''}</div></td>
          <td class="why">${pill(c.verdict)}<div class="cell-sub">${esc(c.verdict_reason)}</div></td>${all ? `<td>${pill(c.status === 'active' ? 'neutral' : c.status, c.status)}</td>` : ''}
          <td class="num">${n(c.attempts)}</td>${all ? `<td class="num">${n(c.brands_reached)}</td><td class="num">${p(c.reply_rate_pct)}</td>` : ''}<td class="num">${p(c.positive_reply_rate_pct)}</td>${all ? `<td class="num">${n(c.meetings_held)}</td><td class="num">${n(c.qualified_brands)}</td>` : ''}
          <td class="num">${n(c.opportunities)}</td>${all ? `<td class="num">${n(c.proposals)}</td>` : ''}<td class="num">${n(c.confirmed)}</td><td class="num">${p(c.win_rate_closed_pct)}</td>
          <td><div style="display:flex;gap:6px;align-items:center"><div class="bar" style="width:${(70 * c.confirmed_value_inr) / maxV}px"></div><span class="num">${L(c.confirmed_value_inr)}</span></div></td>
          ${all ? `<td class="num">${L(c.avg_deal_inr)}</td><td class="num">${L(c.open_pipeline_inr)}</td><td class="num">${c.median_days_open_to_confirmed ?? '–'}</td>` : ''}
          ${all || hasPlan ? `<td class="num">${c.budget_inr != null ? L(c.budget_inr) : '<span class="muted">not set</span>'}</td>` : ''}${hasPlan ? `<td class="num">${L(c.spend_inr)}</td>` : ''}</tr>`).join('')}</tbody></table></div>
        <p class="muted small" style="margin-top:8px">Positive replies = positive replies ÷ attempts. Win rate = confirmed ÷ closed deals (confirmed, lost, withdrawn). ${hasPlan ? 'Calls compare actuals with the Task 1 week-by-week plan.' : 'Calls follow the rules in Data & settings; change a threshold there and every call updates.'} Credit: touches go to the campaign that made them, deals to the campaign that opened them.</p></div>
      ${hasPlan ? routesTable(E.planStatus(sn)) : ''}
      <div class="card"><header><h3>Where brands drop out, by ${esc(gb)}</h3><label class="field"><span>Group by</span><select data-change="funnel-by">${['campaign', 'channel', 'owner', hasPlan ? 'domain' : 'industry'].map((g) => `<option ${g === gb ? 'selected' : ''}>${g}</option>`).join('')}</select></label></header>
        <p class="muted small" style="margin-bottom:8px">${esc(fun.note)}</p>
        <div class="table-wrap"><table class="funnel-tbl"><thead><tr><th>${esc(gb)}</th>${fun.groups[0] ? fun.groups[0].stages.map((s) => `<th class="num">${esc(s.label)}</th>`).join('') : ''}<th class="num">Confirmed value</th></tr></thead>
        <tbody>${fun.groups.map((g) => `<tr><td>${esc(g.group)}</td>${g.stages.map((s) => `<td class="num">${s.value}${s.conv_from_prev_pct != null ? `<div class="cell-sub">${s.conv_from_prev_pct}%</div>` : ''}</td>`).join('')}<td class="num">${L(g.confirmed_value_inr)}</td></tr>`).join('')}</tbody></table></div></div>`;
  }
  function routesTable(ps) {
    return `<div class="card"><header><h3>Routes: actual vs the Task 1 plan</h3><span class="tag assumption">plan = assumption</span></header><div class="table-wrap"><table>
      <thead><tr><th>Route</th><th class="num">Accounts</th><th class="num">Conversations</th><th class="num">Proposals</th><th class="num">Wins</th><th class="num">Signed</th></tr></thead>
      <tbody>${ps.routes.map((r) => `<tr><td>${esc(r.route)}</td>${['accounts', 'conversations', 'proposals', 'wins'].map((k) => `<td class="num">${r.actual[k]} <span class="muted">/ ${r.plan ? r.plan[k] : '–'}</span></td>`).join('')}<td class="num">${L(r.actual.signed_inr)} <span class="muted">/ ${r.plan ? L(r.plan.signed_inr, 1) : '–'}</span></td></tr>`).join('')}</tbody></table></div>
      <p class="muted small">Actual / full-campaign plan. Conversations = brands that replied or submitted the interest page.</p></div>`;
  }

  // ---------- DEALS ----------
  function viewDeals() {
    const sn = App.snap; const f = App.f.deals;
    const rows = E.listOpportunities(sn, { stage: f.stage && f.stage !== 'all' ? f.stage : undefined, campaign: f.campaign || undefined, owner: f.owner || undefined, brand: f.q || undefined, stale_days: f.stale ? sn.ws.settings.stale_days : undefined, sort: f.sort });
    const camps = sn.ws.campaigns; const owners = [...new Set(sn.opps.map((o) => o.deal_owner).filter(Boolean))];
    const stages = ['open', 'all', ...E.STAGES];
    const total = rows.reduce((s, r) => s + (r.stage === 'partner_confirmed' ? r.confirmed_value_inr : r.proposed_value_inr), 0);
    return `
      <div class="section-head"><h2>Deals: move each one forward</h2><p>${rows.length} shown · ${L(total)}</p><span class="spacer"></span><button class="btn primary" data-action="new-deal">New deal</button></div>
      <p class="lede">Change a stage or value right in the table and every number updates. Red days mean the deal has sat idle for ${sn.ws.settings.stale_days}+ days.</p>
      <div class="card"><div class="form" style="margin-bottom:10px">
        <label>Stage<select data-change="deal-filter" data-k="stage">${stages.map((s) => `<option value="${s}" ${f.stage === s ? 'selected' : ''}>${label(s)}</option>`).join('')}</select></label>
        <label>Campaign<select data-change="deal-filter" data-k="campaign"><option value="">All</option>${camps.map((c) => `<option value="${esc(c.sponsor_campaign_id)}" ${f.campaign === c.sponsor_campaign_id ? 'selected' : ''}>${esc(c.campaign_name)}</option>`).join('')}</select></label>
        <label>Owner<select data-change="deal-filter" data-k="owner"><option value="">All</option>${owners.map((o) => `<option ${f.owner === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
        <label>Brand<input type="text" placeholder="Search" value="${esc(f.q || '')}" data-change="deal-filter" data-k="q"></label>
        <label>Sort<select data-change="deal-filter" data-k="sort">${['value', 'age', 'created'].map((s) => `<option ${f.sort === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" ${f.stale ? 'checked' : ''} data-change="deal-filter" data-k="stale"> Idle ${sn.ws.settings.stale_days}+ days</label>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Brand</th><th>Stage</th><th class="num">Value (₹)</th><th>Type</th><th>Campaign</th>${sn.ws.plan ? '<th>Bet · property</th>' : ''}<th>Owner</th><th class="num">Days in stage</th><th>Last change</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td><a href="#" data-action="open-brand" data-id="${esc(r.brand_id)}">${esc(r.brand)}</a><div class="cell-sub">${esc(r.opportunity_id)}</div></td>
        <td><select data-change="deal-stage" data-id="${esc(r.opportunity_id)}" aria-label="Stage for ${esc(r.brand)}">${E.STAGES.map((s) => `<option value="${s}" ${r.stage === s ? 'selected' : ''}>${label(s)}</option>`).join('')}${r.stage === 'no stage record yet' ? '<option selected disabled>no stage yet</option>' : ''}</select></td>
        <td class="num"><input type="number" step="5000" min="0" style="width:110px;text-align:right" value="${r.stage === 'partner_confirmed' ? r.confirmed_value_inr : r.proposed_value_inr}" data-change="deal-value" data-id="${esc(r.opportunity_id)}" aria-label="Value for ${esc(r.brand)}"><div class="cell-sub">${L(r.stage === 'partner_confirmed' ? r.confirmed_value_inr : r.proposed_value_inr)}</div></td>
        <td>${esc(r.support_type)}</td><td>${esc(r.campaign)}</td>${sn.ws.plan ? `<td>${esc(r.bet_id || '–')} · ${esc(r.property_id || '–')}</td>` : ''}<td>${esc(r.deal_owner || '–')}</td>
        <td class="num">${r.days_in_stage >= sn.ws.settings.stale_days && !['partner_confirmed', 'lost', 'withdrawn'].includes(r.stage) ? `<b style="color:var(--bad)">${r.days_in_stage}</b>` : r.days_in_stage}</td><td>${dshort(r.last_change)}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No deals match these filters. Set Stage to "all" or clear the search to see more.</td></tr>'}</tbody></table></div></div>`;
  }

  // ---------- PLAN ----------
  function viewPlan() {
    const sn = App.snap;
    if (!sn.ws.plan) {
      return `<div class="section-head"><h2>Bets & cash</h2></div><div class="card"><p>The source dataset has no bets, inventory, payment terms, team hours or budgets, so this page has nothing true to show for it. Switch to <b>Delhi Fest 2027 · live plan (simulated)</b> to run the Task 1 strategy: five ranked bets with weekly gates, the cash path, the 24-property inventory and scenarios.</p>
        <p style="margin-top:10px"><button class="btn primary" data-action="switch-ws" data-id="dl27">Open the Delhi 2027 plan</button></p></div>`;
    }
    const ps = E.planStatus(sn);
    const sc = App.f.scenario || { exclude_tiers: [], exclude_bets: [], collection_rate: sn.ws.settings.collection_rate };
    const scr = E.scenario(sn, sc);
    const series = E.weeklySeries(sn.ws, App.asOf, ['confirmed_cash_value_inr', 'received_inr']).map((r) => Object.assign(r, { floor: floorAt(sn.ws.plan, r.week_ending) }));
    const betCard = (b) => {
      const src = sn.ws.plan.bets.find((x) => x.bet_id === b.bet_id);
      const sig = signalInputs(src);
      return `<div class="card bet"><header><div><div class="eyebrow">${b.rank ? 'Bet ' + b.rank : 'Anchor'} · ${esc(b.owner)}</div><h3>${esc(b.name)}</h3></div>${pill(b.gate.state)}</header>
        <div class="gate ${esc(b.gate.state)}">${esc(b.gate.reason)}${b.gate.action ? `<br><b>Action:</b> ${esc(b.gate.action)}` : ''}</div>
        <div class="stats"><div><b>${L(b.signed_inr)}</b><span>signed of ${L(b.plan_signed_inr, 1)}</span></div><div><b>${b.proposals}</b><span>proposals · ${b.open_deals} open</span></div><div><b>${L(b.total_cost_inr)}</b><span>cost (acq + fulfil)</span></div>
          <div><b>${b.current_cash_per_rupee_at_plan_value}×</b><span>cash per ₹ (plan ${b.plan_cash_per_rupee}×)</span></div><div><b>${b.hours_logged ?? '–'}/${b.hours_planned}</b><span>hours logged</span></div><div><b>${b.validated_cash_per_hour_inr != null ? inr(b.validated_cash_per_hour_inr) : '–'}</b><span>validated cash/hour</span></div></div>
        <details><summary class="small">Gate rule and weekly signals</summary><p class="small muted" style="margin:6px 0">${esc(b.gate.rule || '')}</p>
          <div class="signals">${sig}<label>Hours logged<input type="number" min="0" value="${src.hours_logged ?? ''}" data-change="bet-field" data-bet="${esc(b.bet_id)}" data-k="hours_logged"></label></div></details>
        <div><button class="btn sm" data-action="task-from-bet" data-bet="${esc(b.bet_id)}">Create task</button></div></div>`;
    };
    const cpRows = ps.cash_path.map((c) => `<tr><td>${esc(c.label)}<div class="cell-sub">T−${c.t_minus} · ${dshort(c.week_end)}</div></td><td class="num">${L(c.signed_floor_inr, 1)}</td><td class="num">${c.due_inr != null ? L(c.due_inr, 1) : '–'}</td>
      <td class="num">${c.received_green_inr != null ? `≥ ${L(c.received_green_inr, 1)}` : '≥ floor'}</td><td class="num">${c.passed ? L(c.signed_at_checkpoint_inr) : '–'}</td><td class="num">${c.passed ? L(c.received_at_checkpoint_inr) : '–'}</td><td data-tip="${esc(c.derivation)}">${c.passed ? pill(c.band) : pill('pending', 'upcoming')}</td></tr>`).join('');
    const tiers = ['title', 'signature', 'category', 'competition', 'supporting'];
    return `
      <div class="section-head"><h2>Bets & cash: are we on the path to ₹20.4L?</h2><p>Week ${ps.campaign_week} of ${ps.weeks_total} · T−${ps.t_minus_days} · base ${L(ps.targets.base_signed_inr, 1)} signed → ${L(ps.targets.base_cash_inr, 2)} cash at ${Math.round(ps.targets.collection_rate * 100)}% collection</p></div>
      <div class="two">
        <div class="card"><header><h3>Cash path</h3><span class="muted small">signed vs the weekly floor · amber 85–100%, red below 85%</span></header>${lineChart(series, [{ key: 'confirmed_cash_value_inr', name: 'Signed', color: 'var(--series-1)' }, { key: 'received_inr', name: 'Received', color: 'var(--series-3)' }, { key: 'floor', name: 'Signed floor', color: 'var(--ink-3)', dash: true, step: true }], { fmt: (v) => L(v, 1), aria: 'Cash path' })}</div>
        <div class="card"><header><h3>Checkpoints</h3></header><div class="table-wrap"><table><thead><tr><th>Checkpoint</th><th class="num">Signed floor</th><th class="num">Due</th><th class="num">Green if received</th><th class="num">Signed</th><th class="num">Received</th><th>Band</th></tr></thead><tbody>${cpRows}</tbody></table></div></div>
      </div>
      <div class="bets">${ps.bets.map(betCard).join('')}</div>
      <div class="two">
        <div class="card"><header><h3>Scenario: reforecast the plan</h3><span class="tag calc">calc</span></header>
          <div class="form">
            <div class="wide"><div class="eyebrow" style="margin-bottom:4px">Assume unsold</div><div class="chips">${tiers.map((t) => `<label class="chip"><input type="checkbox" ${sc.exclude_tiers.includes(t) ? 'checked' : ''} data-change="scn-tier" data-k="${t}"> ${t}</label>`).join('')}</div></div>
            <div class="wide"><div class="eyebrow" style="margin-bottom:4px">Drop bets</div><div class="chips">${sn.ws.plan.bets.map((b) => `<label class="chip"><input type="checkbox" ${sc.exclude_bets.includes(b.bet_id) ? 'checked' : ''} data-change="scn-bet" data-k="${b.bet_id}"> ${esc(b.name)}</label>`).join('')}</div></div>
            <label>Collection rate: <b>${Math.round(sc.collection_rate * 100)}%</b><input type="range" min="0.5" max="1" step="0.05" value="${sc.collection_rate}" data-change="scn-rate"></label>
          </div>
          <div class="kpis" style="margin-top:12px">${kpi('Plan signed', L(scr.plan_signed_inr, 2), `${scr.plan_deals} deals · ${scr.vs_base.signed_delta_inr >= 0 ? '+' : ''}${L(scr.vs_base.signed_delta_inr)} vs base`)}${kpi('Plan cash', L(scr.plan_cash_inr, 2), `${scr.uplift_on_last_year_cash_pct >= 0 ? '+' : ''}${scr.uplift_on_last_year_cash_pct}% vs last year's ₹20.0L confirmed`)}${kpi('Pipeline-only cash', L(scr.live.projected_cash_inr, 2), 'signed to date + open deals weighted by stage')}</div>
          <p class="muted small" style="margin-top:6px">Task 1 checks: title unsold → ₹17.0L; both signatures unsold → ₹16.15L; 70% collection → ₹16.8L.</p></div>
        <div class="card"><header><h3>Inventory: 24 properties</h3><span class="muted small">${tiers.map((t) => `${t} ${ps.inventory.by_tier[t].sold}/${ps.inventory.by_tier[t].total}`).join(' · ')}</span></header>
          <div class="inv">${ps.inventory.properties.map((pp) => `<div class="${pp.status}" data-tip="${esc(pp.name + (pp.deal_brand ? ' · ' + pp.deal_brand + ' ' + L(pp.deal_value_inr) : ''))}"><b>${esc(pp.property_id)} · ${esc(pp.tier)}</b><span class="small">${esc(pp.name)}</span><span class="small">${pill(pp.status)} ${L(pp.list_price_inr, 1)} list</span></div>`).join('')}</div></div>
      </div>
      <div class="card"><header><h3>Budget and capacity</h3><span class="tag assumption">assumption</span></header><div class="kpis">
        ${kpi('Acquisition budget', L(ps.budget.acquisition_inr, 2), `${L(ps.budget.spend_to_date_inr)} fulfilment committed so far`)}
        ${kpi('Fulfilment', L(ps.budget.fulfilment_current_inr, 2), `plan ${L(ps.budget.fulfilment_plan_inr, 1)} · ${ps.budget.fulfilment_current_inr > ps.budget.fulfilment_plan_inr ? `<b style="color:var(--bad)">${L(ps.budget.fulfilment_current_inr - ps.budget.fulfilment_plan_inr)} over, contingency ${L(ps.budget.contingency_inr, 1)}</b>` : 'within plan'}`)}
        ${kpi('Team hours', `${ps.capacity.hours_logged_bets}`, `logged of ${ps.capacity.hours_planned_bets} planned on bets · ${ps.capacity.hours_total} total capacity`, (100 * ps.capacity.hours_logged_bets) / ps.capacity.hours_planned_bets)}
      </div></div>`;
  }
  function signalInputs(b) {
    const s = b.signals || {}; const id = esc(b.bet_id);
    const num = (k, lab) => `<label>${lab}<input type="number" min="0" value="${s[k] ?? ''}" data-change="bet-signal" data-bet="${id}" data-k="${k}"></label>`;
    const bool = (k, lab) => `<label>${lab}<select data-change="bet-signal" data-bet="${id}" data-k="${k}" data-bool="1"><option value="" ${s[k] == null ? 'selected' : ''}>unknown</option><option value="true" ${s[k] === true ? 'selected' : ''}>yes</option><option value="false" ${s[k] === false ? 'selected' : ''}>no</option></select></label>`;
    switch (b.gate_type) {
      case 'title': return num('qualified_buyers', 'Qualified buyers') + num('proposal_week', 'Proposal week');
      case 'talent': return num('qualified_calls', 'Qualified calls');
      case 'comfort': return `<label>Delivery quote (₹)<input type="number" min="0" step="1000" value="${b.fulfil_quote_inr ?? ''}" data-change="bet-field" data-bet="${id}" data-k="fulfil_quote_inr"></label>`;
      case 'creator': return bool('sample_reviewed', 'Sample reviewed') + bool('rights_cleared', 'Rights cleared');
      case 'circuit': return num('societies_committed', 'Societies committed');
      case 'trail': return bool('rehearsal_passed', 'Rehearsal passed') + `<label>Rehearsal date<input type="date" value="${esc(s.rehearsal_date || '')}" data-change="bet-signal" data-bet="${id}" data-k="rehearsal_date"></label>`;
      default: return '';
    }
  }

  // ---------- TASKS ----------
  function viewTasks() {
    const sn = App.snap; const f = App.f.tasks;
    const tv = E.tasksView(sn, { owner: f.owner || undefined });
    const owners = [...new Set(sn.ws.tasks.map((t) => t.owner).filter(Boolean))];
    const cols = [['todo', 'To do'], ['in_progress', 'In progress'], ['blocked', 'Blocked'], ['done', 'Done']];
    const card = (t) => {
      const raw = sn.ws.tasks.find((x) => x.task_id === t.task_id) || {};
      return `<div class="task ${t.overdue ? 'overdue' : ''}"><div class="t">${esc(t.title)}</div>
        <div class="meta"><span>${esc(t.owner || 'No owner')}</span><span>${t.overdue ? '<b style="color:var(--bad)">Overdue · ' + dshort(t.due_date) + '</b>' : 'Due ' + dshort(t.due_date)}</span><span>${esc(t.priority || '')}</span>${t.linked ? `<span>↳ ${esc(t.linked)}</span>` : ''}${t.source === 'ai' ? '<span class="tag calc">from analyst</span>' : ''}</div>
        ${raw.notes ? `<div class="small muted">${esc(raw.notes)}</div>` : ''}
        <div class="acts"><select data-change="task-status" data-id="${esc(t.task_id)}" aria-label="Status">${cols.map(([k, l]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn sm" data-action="edit-task" data-id="${esc(t.task_id)}">Edit</button></div></div>`;
    };
    return `
      <div class="section-head"><h2>Tasks: who does what, by when</h2><p>${tv.counts.total} tasks · ${tv.counts.overdue} overdue as of ${dshort(App.asOf)}</p><span class="spacer"></span>
        <label class="field"><span>Owner</span><select data-change="task-owner"><option value="">Everyone</option>${owners.map((o) => `<option ${f.owner === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
        <button class="btn primary" data-action="new-task">New task</button></div>
      ${tv.counts.total ? `<div class="board">${cols.map(([k, l]) => { const ts = tv.tasks.filter((t) => t.status === k); return `<div class="col"><h3>${l}<span class="muted">${ts.length}</span></h3>${ts.map(card).join('') || '<p class="muted small" style="padding:4px">None</p>'}</div>`; }).join('')}</div>`
        : `<div class="card"><h3>No tasks yet</h3><p class="muted" style="margin-top:6px">The source dataset has no task records. Create one here, from any item under <a href="#overview">Needs attention</a>, or ask the analyst to draft one: it appears here once you confirm it.</p></div>`}`;
  }

  // ---------- DATA & SETTINGS ----------
  function viewData() {
    const ws = App.ws; const cov = E.dataCoverage(ws); const s = ws.settings; const t = App.snap.targets || {};
    const log = [...ws.change_log].reverse();
    return `
      <div class="section-head"><h2>Data & settings</h2></div><p class="lede">The original records are never changed. Your edits are kept as a list on top of them, so you can undo one or reset them all.</p>
      <div class="two">
        <div class="card"><header><h3>Change log</h3><span class="muted small">${log.length} changes</span></header>
          <div class="table-wrap" style="max-height:340px"><table><thead><tr><th>Saved</th><th>Effective</th><th>Change</th><th>By</th></tr></thead><tbody>
          ${log.map((c) => `<tr><td class="small">${esc((c.at || '').replace('T', ' ').slice(0, 16))}</td><td class="small">${dshort(c.effective_at)}</td><td>${c.error ? `<span style="color:var(--bad)">Skipped: ${esc(c.error)}</span>` : esc(c.text)}</td><td>${c.source === 'ai' ? '<span class="tag calc">analyst, confirmed</span>' : 'you'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No changes yet.</td></tr>'}
          </tbody></table></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn danger" data-action="reset-ask" ${log.length ? '' : 'disabled title="Nothing to reset yet"'}>Reset to original data</button><button class="btn" data-action="export">Copy change log</button></div>
          <div id="reset-confirm" hidden class="banner" style="margin-top:8px">Remove all ${log.length} changes in this workspace from this browser and restore the original data? <button class="btn sm danger" data-action="reset-do">Yes, reset</button><button class="btn sm" data-action="reset-cancel">Cancel</button></div>
          <textarea id="export-box" hidden rows="6" style="width:100%;margin-top:8px"></textarea></div>
        <div class="card"><header><h3>Targets</h3><span class="muted small">current: ${esc(t.target_version || '–')}</span></header>
          <form class="form" data-submit="targets">
            <label>Qualified brands goal<input type="number" name="qualified_brands_goal" value="${t.qualified_brands_goal ?? ''}"></label>
            <label>Confirmed partnerships goal<input type="number" name="confirmed_partnerships_goal" value="${t.confirmed_partnerships_goal ?? ''}"></label>
            <label>Signed value goal (₹)<input type="number" name="signed_value_goal_inr" value="${t.signed_value_goal_inr ?? ''}"></label>
            <label class="wide">Version label<input type="text" name="target_version" value="" placeholder="e.g. Revised after week 4 review"></label>
            <div><button class="btn primary">Save new target version</button></div></form>
          <p class="muted small" style="margin-top:8px">A new version takes effect on the as-of date (${dshort(App.asOf)}); earlier dates keep the earlier targets.</p></div>
      </div>
      <div class="two">
        <div class="card"><header><h3>Decision rules</h3><span class="tag assumption">assumption</span></header>
          <form class="form" data-submit="settings">
            <label>Scale: min confirmed<input type="number" name="verdict.scale_min_wins" value="${s.verdict.scale_min_wins}"></label>
            <label>Scale: min win rate %<input type="number" name="verdict.scale_min_win_rate" value="${s.verdict.scale_min_win_rate}"></label>
            <label>Stop: min attempts<input type="number" name="verdict.stop_min_attempts" value="${s.verdict.stop_min_attempts}"></label>
            <label>Stop: positive reply rate below %<input type="number" name="verdict.stop_max_positive_rate" value="${s.verdict.stop_max_positive_rate}"></label>
            <label>Idle deal after (days)<input type="number" name="stale_days" value="${s.stale_days}"></label>
            <label>Collection rate<input type="number" step="0.01" min="0" max="1" name="collection_rate" value="${s.collection_rate}"></label>
            ${Object.entries(s.stage_win_prior).map(([k, v]) => `<label>Prior win rate · ${label(k)}<input type="number" step="0.05" min="0" max="1" name="stage_win_prior.${k}" value="${v}"></label>`).join('')}
            <div><button class="btn primary">Save rules</button></div></form>
          <p class="muted small" style="margin-top:8px">Stage priors apply only when fewer than ${s.min_closed_for_empirical} deals have closed; otherwise win rates come from the data.</p></div>
        <div class="card"><header><h3>What this data can and cannot answer</h3></header>
          <ul style="margin:0 0 10px;padding-left:18px">${cov.what_the_data_cannot_answer.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          <div class="eyebrow">Records</div><p class="small" style="margin:4px 0 10px">${Object.entries(cov.tables).filter(([, v]) => v).map(([k, v]) => `${esc(k)} ${v}`).join(' · ')}</p>
          <div class="eyebrow">Data quality</div><p class="small" style="margin:4px 0 10px">${Object.entries(cov.data_quality).filter(([, v]) => v.duplicates_removed).map(([k, v]) => `${esc(k)}: ${v.duplicates_removed} exact import-retry duplicate${v.duplicates_removed > 1 ? 's' : ''} removed`).join(' · ') || 'No duplicates found.'}</p>
          <div class="eyebrow">Definitions</div><dl class="small" style="margin:4px 0 0">${Object.entries(cov.definitions).map(([k, v]) => `<dt style="font-weight:600">${esc(k)}</dt><dd style="margin:0 0 4px">${esc(v)}</dd>`).join('')}</dl></div>
      </div>`;
  }

  // ---------- drawers ----------
  function drawer(html) {
    closeDrawer();
    const bg = document.createElement('div'); bg.className = 'drawer-bg'; bg.dataset.action = 'close-drawer';
    const d = document.createElement('aside'); d.className = 'drawer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
    d.innerHTML = `<button class="btn sm close" data-action="close-drawer">Close</button>` + html;
    document.body.append(bg, d);
    const first = d.querySelector('input,select,textarea'); if (first) first.focus();
  }
  function closeDrawer() { document.querySelectorAll('.drawer,.drawer-bg').forEach((x) => x.remove()); }
  App.closeDrawer = closeDrawer;

  function taskForm(t = {}, mode = 'new') {
    const owners = ownersList();
    return `<h2>${mode === 'new' ? 'New task' : 'Edit task'}</h2>
      <form class="form" data-submit="task" data-mode="${mode}" data-id="${esc(t.task_id || '')}">
        <label class="wide">Task<input type="text" name="title" required value="${esc(t.title || '')}"></label>
        <label>Owner<input type="text" name="owner" list="owners" required value="${esc(t.owner || '')}"><datalist id="owners">${owners.map((o) => `<option value="${esc(o)}">`).join('')}</datalist></label>
        <label>Due<input type="date" name="due_date" required value="${esc(t.due_date || E.addDays(App.asOf, 3))}"></label>
        <label>Priority<select name="priority">${['high', 'medium', 'low'].map((x) => `<option ${(t.priority || 'medium') === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Status<select name="status">${['todo', 'in_progress', 'blocked', 'done'].map((x) => `<option value="${x}" ${(t.status || 'todo') === x ? 'selected' : ''}>${label(x)}</option>`).join('')}</select></label>
        <label class="wide">Linked to<input type="text" name="linked_label" value="${esc(t.linked_label || '')}" placeholder="Campaign, deal, bet or brand"></label>
        <label class="wide">Notes<textarea name="notes" rows="3">${esc(t.notes || '')}</textarea></label>
        <input type="hidden" name="linked_type" value="${esc(t.linked_type || '')}"><input type="hidden" name="linked_id" value="${esc(t.linked_id || '')}">
        <div style="display:flex;gap:8px"><button class="btn primary">${mode === 'new' ? 'Create task' : 'Save'}</button>${mode !== 'new' ? `<button type="button" class="btn danger" data-action="delete-task" data-id="${esc(t.task_id)}">Delete</button>` : ''}</div>
      </form>`;
  }
  function ownersList() {
    const ws = App.ws; const s = new Set();
    (ws.team || []).forEach((t) => s.add(t.name)); ws.brands.forEach((b) => b.owner_name && s.add(b.owner_name)); ws.campaigns.forEach((c) => c.owner_name && s.add(c.owner_name)); ws.tasks.forEach((t) => t.owner && s.add(t.owner));
    ws.opp_history.forEach((h) => h.owner_name && s.add(h.owner_name));
    return [...s].sort();
  }
  App.ownersList = ownersList;

  function openCampaign(id) {
    const sn = App.snap; const c = E.campaignKpis(sn).find((x) => x.sponsor_campaign_id === id); const raw = sn.ws.campaigns.find((x) => x.sponsor_campaign_id === id);
    const deals = E.listOpportunities(sn, { campaign: id });
    drawer(`<div><div class="eyebrow">${esc(c.channel)} · ${esc(id)}</div><h2>${esc(c.campaign_name)}</h2><p class="muted small" style="margin-top:4px">${esc(raw.objective || '')}${raw.audience ? ' · ' + esc(raw.audience) : ''}</p></div>
      <div>${pill(c.verdict)} <span class="small">${esc(c.verdict_reason)}</span></div>
      <div class="kpis">${kpi('Confirmed', `${c.confirmed}`, `${L(c.confirmed_value_inr)} · win rate ${p(c.win_rate_closed_pct)}`)}${kpi('Replies', `${c.replies}`, `${p(c.reply_rate_pct)} of ${c.attempts} attempts · ${c.positive_replies} positive`)}${kpi('Open pipeline', L(c.open_pipeline_inr), `${c.open_opportunities} open deals`)}</div>
      ${c.plan_pace ? `<p class="small">Plan pace by week ${c.plan_pace.week}: conversations ${c.plan_pace.pace.conversations}×, proposals ${c.plan_pace.pace.proposals}×, signed ${c.plan_pace.pace.signed}× <span class="tag assumption">ramp</span></p>` : ''}
      <form class="form" data-submit="campaign" data-id="${esc(id)}"><label>Status<select name="status">${['active', 'paused', 'stopped'].map((s) => `<option ${raw.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Owner<input type="text" name="owner_name" list="owners2" value="${esc(raw.owner_name || '')}"><datalist id="owners2">${ownersList().map((o) => `<option value="${esc(o)}">`).join('')}</datalist></label>
        <label>Budget (₹)<input type="number" name="budget_inr" value="${raw.budget_inr ?? ''}" placeholder="not in source data"></label><label>Spend to date (₹)<input type="number" name="spend_inr" value="${raw.spend_inr ?? ''}"></label>
        <label>Planned end<input type="date" name="planned_end_at" value="${esc((raw.planned_end_at || '').slice(0, 10))}"></label>
        <label class="wide">Notes<textarea name="notes" rows="2">${esc(raw.notes || '')}</textarea></label><div><button class="btn primary">Save campaign</button></div></form>
      <div><h3 style="margin-bottom:6px">Deals from this campaign (${deals.length})</h3><div class="table-wrap"><table><tbody>${deals.map((d) => `<tr><td><a href="#" data-action="open-brand" data-id="${esc(d.brand_id)}">${esc(d.brand)}</a></td><td>${esc(label(d.stage))}</td><td class="num">${L(d.stage === 'partner_confirmed' ? d.confirmed_value_inr : d.proposed_value_inr)}</td><td class="num">${d.days_in_stage}d</td></tr>`).join('')}</tbody></table></div></div>
      <div><button class="btn" data-action="task-for" data-type="campaign" data-id="${esc(id)}" data-label="${esc(c.campaign_name)}" data-owner="${esc(c.owner_name || '')}">Create task for this campaign</button></div>`);
  }

  function openBrand(id) {
    const sn = App.snap; const b = E.brandDetail(sn, id);
    if (!b.found) { toast(b.note); return; }
    const camps = sn.ws.campaigns;
    drawer(`<div><div class="eyebrow">${esc(b.brand_id)} · ${esc(b.industry || '')} · owner ${esc(b.owner || '–')}</div><h2>${esc(b.brand_name)}</h2>${!b.exists_as_of ? '<p class="small" style="color:var(--warn)">This brand was added after the as-of date.</p>' : ''}</div>
      <div><div class="eyebrow">Contacts</div><p class="small">${b.contacts.map((c) => `${esc(c.name)} (${esc(c.title)})`).join(', ') || 'None'}</p></div>
      <form class="form" data-submit="qual" data-id="${esc(b.brand_id)}"><label>Qualification<select name="qualification_status">${E.QUAL_STATUSES.map((s) => `<option ${b.qualification_now && b.qualification_now.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label class="wide">Reason<input type="text" name="reason" value="" placeholder="${esc(b.qualification_now ? b.qualification_now.reason : '')}"></label><div><button class="btn">Update</button></div></form>
      <div><div class="eyebrow">Deals</div>${b.opportunities.map((o) => `<p class="small"><b>${esc(o.id)}</b> · ${esc(o.stage)} · ${L(o.stage === 'partner_confirmed' ? o.confirmed_value_inr : o.proposed_value_inr)} · ${esc(o.support_type)} · ${esc(o.campaign)} · history: ${o.history.map((h) => `${dshort(h[0])} ${label(h[1])}`).join(' → ')}</p>`).join('') || '<p class="small muted">No deal yet.</p>'}
        ${b.opportunities.length ? '' : `<button class="btn sm" data-action="new-deal" data-brand="${esc(b.brand_name)}">Open a deal</button>`}</div>
      <div><div class="eyebrow">Timeline (${b.timeline.length})</div><div class="timeline">${b.timeline.map((x) => `<div>${esc(x)}</div>`).join('') || 'No interactions.'}</div></div>
      <div><div class="eyebrow" style="margin-bottom:6px">Log an interaction</div><form class="form" data-submit="interaction" data-id="${esc(b.brand_id)}">
        <label>Campaign<select name="sponsor_campaign_id">${camps.map((c) => `<option value="${esc(c.sponsor_campaign_id)}">${esc(c.campaign_name)}</option>`).join('')}</select></label>
        <label>Event<select name="ev">${[['outreach_sent|sent', 'Outreach sent'], ['replied|positive', 'Replied: positive'], ['replied|neutral', 'Replied: neutral'], ['replied|not_interested', 'Replied: not interested'], ['meeting_booked|scheduled', 'Meeting booked'], ['meeting_held|attended', 'Meeting held'], ['opt_out|do_not_contact', 'Opted out']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        <label class="wide">Note<input type="text" name="summary"></label><div><button class="btn">Log</button></div></form></div>
      ${b.activations.length ? `<div><div class="eyebrow">Activations</div>${b.activations.map((a) => `<p class="small">${esc(a.attendee_campaign)} · ${dshort(a.linked_at)} · ${esc(a.note)}</p>`).join('')}</div>` : ''}
      <div><button class="btn" data-action="task-for" data-type="brand" data-id="${esc(b.brand_id)}" data-label="${esc(b.brand_name)}" data-owner="${esc(b.owner || '')}">Create task for this brand</button></div>`);
  }

  function newDealForm(brand) {
    const sn = App.snap; const plan = sn.ws.plan;
    drawer(`<h2>New deal</h2><form class="form" data-submit="deal">
      <label class="wide">Brand (existing or new)<input type="text" name="brand_name" required list="brandlist" value="${esc(brand || '')}"><datalist id="brandlist">${sn.ws.brands.map((b) => `<option value="${esc(b.brand_name)}">`).join('')}</datalist></label>
      <label>Industry (new brand)<input type="text" name="industry"></label>
      <label>Campaign<select name="sponsor_campaign_id">${sn.ws.campaigns.map((c) => `<option value="${esc(c.sponsor_campaign_id)}">${esc(c.campaign_name)}</option>`).join('')}</select></label>
      <label>Stage<select name="stage">${E.OPEN_STAGES.concat(['partner_confirmed']).map((s) => `<option value="${s}">${label(s)}</option>`).join('')}</select></label>
      <label>Value (₹)<input type="number" name="proposed_value_inr" required min="0" step="5000" value="100000"></label>
      <label>Support<select name="support_type"><option>cash</option><option>in_kind</option></select></label>
      <label>Owner<input type="text" name="owner_name" list="owners3"><datalist id="owners3">${ownersList().map((o) => `<option value="${esc(o)}">`).join('')}</datalist></label>
      ${plan ? `<label>Bet<select name="bet_id"><option value="">None</option>${plan.bets.map((b) => `<option value="${esc(b.bet_id)}">${esc(b.name)}</option>`).join('')}</select></label>
      <label>Property<select name="property_id"><option value="">None</option>${plan.properties.map((pp) => `<option value="${esc(pp.property_id)}">${esc(pp.property_id + ' · ' + pp.name)}</option>`).join('')}</select></label>` : ''}
      <div><button class="btn primary">Create deal</button></div></form>`);
  }

  // ---------- render ----------
  function render() {
    if (!App.ws) return;
    renderHeader();
    const fn = { overview: viewOverview, campaigns: viewCampaigns, deals: viewDeals, plan: viewPlan, tasks: viewTasks, data: viewData }[App.view] || viewOverview;
    const main = document.getElementById('main');
    try { main.innerHTML = fn(); } catch (err) { console.error(err); main.innerHTML = `<div class="card"><h3>Could not render this view</h3><p class="muted">${esc(err.message)}</p></div>`; }
    const TAG_TIP = { fact: 'FACT: read directly from the data', calc: 'CALC: computed here from the data; hover the number or ask the analyst for the working', assumption: 'ASSUMPTION: a plan input or estimate; change it in Data & settings or Bets & cash', sim: 'SIMULATED: invented data that shows how the plan would run' };
    document.querySelectorAll('.tag').forEach((g) => { const k = Object.keys(TAG_TIP).find((c) => g.classList.contains(c)); if (k && !g.dataset.tip) g.dataset.tip = TAG_TIP[k]; });
    const on = aiOn();
    document.getElementById('shell').classList.toggle('chat-closed', !on || !App.chatOpen);
    const chat = document.getElementById('chat'); if (chat) chat.hidden = !on;
    const fab = document.getElementById('fab'); if (fab) fab.hidden = !on || App.chatOpen;
  }
  App.render = render;

  // ---------- events ----------
  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-action]'); if (!el) return;
    const a = el.dataset.action;
    if (el.tagName === 'A') ev.preventDefault();
    const sn = App.snap;
    switch (a) {
      case 'go': App.go(el.dataset.view); break;
      case 'toggle-chat': App.chatOpen = !App.chatOpen; prefs('chat', App.chatOpen); render(); if (App.chatOpen) { const i = document.getElementById('chat-text'); i && i.focus(); } break;
      case 'asof-latest': App.asOf = App.bases[App.wsId].workspace.default_as_of; App.recompute(); render(); break;
      case 'switch-ws': App.setWorkspace(el.dataset.id); break;
      case 'close-drawer': closeDrawer(); break;
      case 'open-campaign': openCampaign(el.dataset.id); break;
      case 'open-brand': ev.preventDefault(); openBrand(el.dataset.id); break;
      case 'new-deal': newDealForm(el.dataset.brand); break;
      case 'new-task': drawer(taskForm({}, 'new')); break;
      case 'new-campaign': drawer(`<h2>New campaign</h2><form class="form" data-submit="new-campaign"><label class="wide">Name<input name="campaign_name" required></label><label>Channel<select name="channel">${['email', 'linkedin', 'introduction', 'web_inbound', 'in_person'].map((c) => `<option>${c}</option>`).join('')}</select></label><label>Owner<input name="owner_name" list="o4"><datalist id="o4">${ownersList().map((o) => `<option value="${esc(o)}">`).join('')}</datalist></label><label>Budget (₹)<input type="number" name="budget_inr"></label><label class="wide">Objective<input name="objective"></label><div><button class="btn primary">Create</button></div></form>`); break;
      case 'edit-task': { const t = sn.ws.tasks.find((x) => x.task_id === el.dataset.id); drawer(taskForm(t, 'edit')); break; }
      case 'delete-task': await App.edit('task_delete', { task_id: el.dataset.id }, { toast: 'Task deleted' }); closeDrawer(); break;
      case 'task-from-alert': { const it = attentionItems()[+el.dataset.i]; drawer(taskForm(Object.assign({ due_date: E.addDays(App.asOf, 2), priority: it.sev === 'stop' ? 'high' : 'medium', notes: it.why }, it.task), 'new')); break; }
      case 'task-from-bet': { const b = E.planStatus(sn).bets.find((x) => x.bet_id === el.dataset.bet); drawer(taskForm({ title: `${b.name}: ${b.gate.action || 'act on gate'}`, owner: b.owner, linked_type: 'bet', linked_id: b.bet_id, linked_label: b.name, notes: b.gate.reason, priority: b.gate.state === 'stop' ? 'high' : 'medium', due_date: E.addDays(App.asOf, 3) }, 'new')); break; }
      case 'task-for': drawer(taskForm({ linked_type: el.dataset.type, linked_id: el.dataset.id, linked_label: el.dataset.label, owner: el.dataset.owner, title: '' }, 'new')); break;
      case 'reset-ask': document.getElementById('reset-confirm').hidden = false; break;
      case 'reset-cancel': document.getElementById('reset-confirm').hidden = true; break;
      case 'undo': { const r = await S.remove(App.wsId, el.dataset.id); toast(r.ok ? 'Undone' : r.error); break; }
      case 'guide-close': prefs('guide_done', true); render(); break;
      case 'guide-open': prefs('guide_done', false); App.go('overview'); break;
      case 'alerts-all': App.f.alertsAll = !App.f.alertsAll; render(); break;
      case 'camp-cols': App.f.campCols = !App.f.campCols; render(); break;
      case 'ai-setup': drawer(window.GCAI.setupHtml()); break;
      case 'ai-remove': window.GCAI.removeCfg(); closeDrawer(); App.chatOpen = aiOn(); render(); toast(aiOn() ? 'Your key was removed. Using the built-in analyst.' : 'Key removed from this browser'); break;
      case 'ask': { if (!aiOn()) { drawer(window.GCAI.setupHtml()); break; } App.chatOpen = true; prefs('chat', true); render(); const i = document.getElementById('chat-text'); if (i) { i.value = el.dataset.q; const f = document.getElementById('chat-form'); if (f && f.requestSubmit) f.requestSubmit(); else i.focus(); } break; }
      case 'reset-do': { const r = await S.reset(App.wsId); toast(r.ok ? 'Workspace reset to the original data' : r.error); break; }
      case 'export': { const box = document.getElementById('export-box'); box.hidden = false; box.value = S.exportEdits(App.wsId); box.select(); try { await navigator.clipboard.writeText(box.value); toast('Change log copied'); } catch (e) { toast('Select the text to copy it'); } break; }
      default: break;
    }
  });

  document.addEventListener('change', async (ev) => {
    const el = ev.target.closest('[data-change]'); if (!el) return;
    const k = el.dataset.change;
    switch (k) {
      case 'workspace': App.setWorkspace(el.value); break;
      case 'asof': if (el.value) { const max = App.bases[App.wsId].workspace.default_as_of; App.asOf = el.value > max ? max : el.value; App.recompute(); render(); } break;
      case 'funnel-by': App.f.funnelBy = el.value; render(); break;
      case 'deal-filter': App.f.deals[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; render(); break;
      case 'deal-stage': { const r = await App.edit('opp_stage', { opportunity_id: el.dataset.id, stage: el.value }, { toast: 'Stage updated' }); break; }
      case 'deal-value': { const o = App.snap.opps.find((x) => x.opportunity_id === el.dataset.id); await App.edit('opp_stage', { opportunity_id: el.dataset.id, stage: o.stage || 'prospecting', proposed_value_inr: Number(el.value) }, { toast: 'Value updated' }); break; }
      case 'task-status': await App.edit('task_update', { task_id: el.dataset.id, fields: { status: el.value } }, { toast: 'Task moved' }); break;
      case 'task-owner': App.f.tasks.owner = el.value; render(); break;
      case 'bet-signal': { let v = el.value; if (el.dataset.bool) v = v === '' ? null : v === 'true'; else if (el.type === 'number') v = v === '' ? null : Number(v); await App.edit('bet_update', { bet_id: el.dataset.bet, signals: { [el.dataset.k]: v } }, { toast: 'Signal saved; gate recomputed' }); break; }
      case 'bet-field': await App.edit('bet_update', { bet_id: el.dataset.bet, [el.dataset.k]: el.value === '' ? null : Number(el.value) }, { toast: 'Saved; gate recomputed' }); break;
      case 'scn-tier': case 'scn-bet': { const sc = App.f.scenario || { exclude_tiers: [], exclude_bets: [], collection_rate: App.ws.settings.collection_rate }; const arr = k === 'scn-tier' ? sc.exclude_tiers : sc.exclude_bets; const i = arr.indexOf(el.dataset.k); if (el.checked && i < 0) arr.push(el.dataset.k); if (!el.checked && i >= 0) arr.splice(i, 1); App.f.scenario = sc; render(); break; }
      case 'scn-rate': { const sc = App.f.scenario || { exclude_tiers: [], exclude_bets: [], collection_rate: App.ws.settings.collection_rate }; sc.collection_rate = Number(el.value); App.f.scenario = sc; render(); break; }
      default: break;
    }
  });

  document.addEventListener('submit', async (ev) => {
    const form = ev.target.closest('form[data-submit]'); if (!form) return;
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(form).entries());
    const kind = form.dataset.submit;
    if (kind === 'ai-cfg') {
      if (!String(fd.key || '').trim()) { toast('Paste an API key first'); return; }
      window.GCAI.saveCfg(fd); App.chatOpen = true; prefs('chat', true); closeDrawer(); render(); toast('Analyst ready. Your key is saved in this browser only.');
      const i = document.getElementById('chat-text'); if (i) i.focus();
      return;
    }
    if (kind === 'task') {
      const fields = { title: fd.title, owner: fd.owner, due_date: fd.due_date, priority: fd.priority, status: fd.status, linked_label: fd.linked_label || null, notes: fd.notes || null, linked_type: fd.linked_type || null, linked_id: fd.linked_id || null };
      const r = form.dataset.mode === 'new' ? await App.edit('task_create', fields, { toast: 'Task created' }) : await App.edit('task_update', { task_id: form.dataset.id, fields }, { toast: 'Task saved' });
      if (r.ok) closeDrawer();
    } else if (kind === 'campaign') {
      const fields = { status: fd.status, owner_name: fd.owner_name || null, budget_inr: fd.budget_inr === '' ? null : Number(fd.budget_inr), spend_inr: fd.spend_inr === '' ? null : Number(fd.spend_inr), notes: fd.notes || null, planned_end_at: fd.planned_end_at ? fd.planned_end_at + 'T18:00:00' : null };
      const r = await App.edit('campaign_update', { sponsor_campaign_id: form.dataset.id, fields }, { toast: 'Campaign saved' }); if (r.ok) closeDrawer();
    } else if (kind === 'new-campaign') {
      const r = await App.edit('campaign_create', { campaign_name: fd.campaign_name, channel: fd.channel, owner_name: fd.owner_name, budget_inr: fd.budget_inr === '' ? null : Number(fd.budget_inr), objective: fd.objective }, { toast: 'Campaign created' }); if (r.ok) closeDrawer();
    } else if (kind === 'deal') {
      const existing = App.ws.brands.find((b) => b.brand_name.toLowerCase() === fd.brand_name.toLowerCase());
      const r = await App.edit('opp_create', { brand_id: existing ? existing.brand_id : undefined, brand_name: fd.brand_name, industry: fd.industry, sponsor_campaign_id: fd.sponsor_campaign_id, stage: fd.stage, proposed_value_inr: Number(fd.proposed_value_inr), support_type: fd.support_type, owner_name: fd.owner_name || null, bet_id: fd.bet_id || null, property_id: fd.property_id || null }, { toast: 'Deal created' });
      if (r.ok) closeDrawer();
    } else if (kind === 'qual') {
      await App.edit('qual_set', { brand_id: form.dataset.id, qualification_status: fd.qualification_status, reason: fd.reason || undefined }, { toast: 'Qualification updated' }); openBrand(form.dataset.id);
    } else if (kind === 'interaction') {
      const [et, oc] = fd.ev.split('|');
      await App.edit('interaction_add', { brand_id: form.dataset.id, sponsor_campaign_id: fd.sponsor_campaign_id, event_type: et, outcome: oc, summary: fd.summary || undefined }, { toast: 'Interaction logged' }); openBrand(form.dataset.id);
    } else if (kind === 'targets') {
      const pl = {}; for (const k of ['qualified_brands_goal', 'confirmed_partnerships_goal', 'signed_value_goal_inr']) if (fd[k] !== '') pl[k] = Number(fd[k]);
      pl.target_version = fd.target_version || 'Edited target';
      await App.edit('target_set', pl, { toast: 'New target version saved' });
    } else if (kind === 'settings') {
      const pl = {};
      for (const [k, v] of Object.entries(fd)) { const parts = k.split('.'); let o = pl; while (parts.length > 1) { const q = parts.shift(); o = o[q] = o[q] || {}; } o[parts[0]] = Number(v); }
      await App.edit('setting_update', pl, { toast: 'Rules saved; every call recomputed' });
    }
  });

  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS.some(([k]) => k === v)) { App.view = v; render(); window.scrollTo(0, 0); } });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeDrawer(); });

  // ---------- boot ----------
  async function boot() {
    const main = document.getElementById('main');
    try {
      const loaded = await Promise.all(WORKSPACES.map((w) => fetch(w.file).then((r) => { if (!r.ok) throw new Error(w.file + ' ' + r.status); return r.json(); })));
      WORKSPACES.forEach((w, i) => { App.bases[w.id] = loaded[i]; });
    } catch (err) { main.innerHTML = `<div class="card"><h3>Could not load the data files</h3><p class="muted">${esc(err.message)}. Serve the folder over HTTP (see README) rather than opening the file directly.</p></div>`; return; }
    const savedWs = prefs('ws'); App.wsId = App.bases[savedWs] ? savedWs : 'cf25';
    App.asOf = App.bases[App.wsId].workspace.default_as_of;
    const v = location.hash.slice(1); if (VIEWS.some(([k]) => k === v)) App.view = v;
    await S.init(WORKSPACES.map((w) => w.id));
    App.recompute();
    window.GCAI && window.GCAI.mount(document.getElementById('chat'), App);
    const ch = prefs('chat'); App.chatOpen = aiOn() && (ch == null ? window.innerWidth > 1100 : ch);
    App.onAiChange = () => { const c = prefs('chat'); App.chatOpen = aiOn() && (c == null ? window.innerWidth > 1100 : c); render(); };
    S.on(() => { App.recompute(); render(); window.GCAI && window.GCAI.refresh && window.GCAI.refresh(); });
    render();
  }
  boot();
})();
