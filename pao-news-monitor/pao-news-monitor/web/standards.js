/* Stakeholder Project Tracker (the Standards tab) - what the standard setters (IAASB, IESBA, IASB, ISSB, IPSASB ...) are working on, and when.
 *
 * Two views of the same data (supabase/update-23.sql: std_projects = a standard, std_events = its dates):
 *   Calendar      a month grid. A period (exposure draft + call for comments) is a bar; a meeting, an issue date or an
 *                 effective date is a small block. Colour = what kind of date; every block also carries a small icon.
 *   By standard   each standard setter, then each of its standards, with a progress line that starts as four steps
 *                 and grows a step for every extra date (a second call for comments, a third meeting ...).
 * Dates come from the daily collection (it reads the setters' emails) or are typed in by people who may "Add items".
 * The rules for layout and progress are in standards-logic.js.
 */
(() => {
  "use strict";
  const A = window.PAOApp, L = window.StdLogic;
  if (!A || !L) return;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = A.esc;
  const today = () => L.ymd(new Date());
  const me = () => A.state.user?.email || "";
  const canEdit = () => A.can("add_items");
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
  const MAX_PER_DAY = 3;

  // a small icon per kind of date, so the kind never depends on colour alone (24x24, drawn with strokes)
  const ICON = {
    work_plan: '<path d="M9 4h6v3H9zM7 5.5H5.5v15h13v-15H17M9 12h6M9 16h4"/>',
    exposure_draft: '<path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5"/>',
    call_for_comments: '<path d="M4 5h16v11H10l-5 4v-4H4z"/>',
    meeting: '<path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"/>',
    feedback_meeting: '<path d="M3 4h12v8H8l-3 3v-3H3zM17 9h4v8h-2v3l-3-3h-5v-2"/>',
    issued: '<path d="M7 3h10v18l-5-3-5 3zM9.5 10l2 2 3.5-4"/>',
    implementation: '<path d="M6 21V4M6 5h11l-2 4 2 4H6"/>',
    other: '<circle cx="12" cy="12" r="4"/>',
  };
  const icon = (type, size = 14) => `<svg class="std-icon" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[type] || ICON.other}</svg>`;

  const now = new Date();
  const S = { projects: [], events: [], setters: [], error: "", loaded: false, view: "calendar",
    month: { y: now.getFullYear(), m: now.getMonth() }, paos: new Set(), project: "", types: new Set(), demo: null,
    openCards: new Set(), closedSetters: new Set() };   // By standard: which standards are expanded (all start folded), which setters were folded by hand

  // ---------- data ----------
  const missing = (e) => /does not exist|schema cache|relation|42P01|PGRST20/i.test(`${e?.code || ""} ${e?.message || ""}`);
  const NEEDS_UPDATE = "The Stakeholder Project Tracker needs a quick database update (supabase/update-23.sql) - ask your admin.";

  async function load() {
    S.error = "";
    if (A.DEMO) {
      const d = A.api.demo || {};
      if (!S.demo) {   // the sample dates are written around one day; move them so the demo always looks current
        const shift = d.std_anchor ? L.diffDays(d.std_anchor, today()) : 0, mv = (x) => (x ? L.addDays(x, shift) : x);
        S.demo = { projects: structuredClone(d.std_projects || []), n: 1000,
          events: (d.std_events || []).map((e) => ({ ...e, start_date: mv(e.start_date), end_date: mv(e.end_date) })) };
      }
      S.projects = S.demo.projects; S.events = S.demo.events;
      S.setters = (d.paos || []).filter((p) => p.jurisdiction === "Standard Setters");
    } else {
      // the setters come from their own query: the main list leaves out organisations that aren't collected (ISSB shares IASB's website)
      const [pa, pr, ev] = await Promise.all([
        A.db.from("paos").select("id,abbr,name,jurisdiction,sort_order").eq("jurisdiction", "Standard Setters").order("sort_order"),
        A.db.from("std_projects").select("*").order("title"),
        A.db.from("std_events").select("*").order("start_date").limit(5000)]);
      const err = pr.error || ev.error || pa.error;
      if (err) { S.error = missing(err) ? NEEDS_UPDATE : `Couldn't load the Project Tracker: ${err.message}`; S.projects = []; S.events = []; S.setters = pa.data || []; }
      else { S.projects = pr.data || []; S.events = ev.data || []; S.setters = pa.data || []; }
    }
    S.setters.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    S.loaded = true;
  }

  async function write(table, op, row, id) {
    if (A.DEMO) {   // demo mode keeps changes in memory until the page is reloaded
      const list = table === "std_projects" ? S.demo.projects : S.demo.events;
      if (op === "delete") {
        const at = list.findIndex((r) => r.id === id); if (at >= 0) list.splice(at, 1);
        if (table === "std_projects") S.demo.events = S.events = S.demo.events.filter((e) => e.project_id !== id);
      } else if (op === "update") Object.assign(list.find((r) => r.id === id) || {}, row);
      else list.push({ ...row, id: table === "std_projects" ? row.id : ++S.demo.n });
      return;
    }
    const q = A.db.from(table);
    const { error } = op === "delete" ? await q.delete().eq("id", id) : op === "update" ? await q.update(row).eq("id", id) : await q.insert(row);
    if (error) throw error;
  }

  const setterOf = (paoId) => S.setters.find((s) => s.id === paoId);
  const abbr = (paoId) => setterOf(paoId)?.abbr || paoId;
  const projectOf = (id) => S.projects.find((p) => p.id === id);
  const filtered = () => L.visible(S.events, S.projects, { paos: S.paos, project: S.project, types: S.types });
  const eventsOf = (projectId) => S.events.filter((e) => e.project_id === projectId);

  // ---------- filters ----------
  function renderFilters() {
    const withData = new Set(S.projects.map((p) => p.pao_id));
    const shown = S.setters.filter((s) => s.active !== false || withData.has(s.id));
    $("#std-paos").innerHTML = shown.map((s) =>
      `<button type="button" class="std-chip" data-pao="${esc(s.id)}" aria-pressed="${S.paos.has(s.id)}" title="${esc(s.name)}">${esc(s.abbr || s.id)}</button>`).join("")
      || `<span class="muted small">No standard setters in the member list yet.</span>`;
    const inScope = S.projects.filter((p) => !S.paos.size || S.paos.has(p.pao_id));
    if (S.project && !inScope.some((p) => p.id === S.project)) S.project = "";
    $("#std-project").innerHTML = `<option value="">All standards</option>` +
      inScope.map((p) => `<option value="${esc(p.id)}">${esc(abbr(p.pao_id))}: ${esc(p.title)}</option>`).join("");
    $("#std-project").value = S.project;
    $("#std-types").innerHTML = L.TYPES.map((t) =>
      `<button type="button" class="std-chip std-type t-${t.key}" data-type="${t.key}" aria-pressed="${S.types.has(t.key)}">${icon(t.key, 13)}<span>${esc(t.label)}</span></button>`).join("");
    for (const b of $$("[data-std-view]")) b.setAttribute("aria-pressed", String(b.dataset.stdView === S.view));
  }

  // ---------- calendar ----------
  const evLabel = (ev) => {
    const p = projectOf(ev.project_id);
    return `${L.typeOf(ev.type).label}${ev.title ? ` (${ev.title})` : ""}: ${p ? `${abbr(p.pao_id)}, ${p.title}` : ""}, ${L.fmtRange(ev.start_date, ev.end_date)}${ev.source === "email" ? ", read from an email, not checked yet" : ""}`;
  };
  function chip(ev, cls, style, text) {
    return `<button type="button" class="std-ev t-${ev.type} ${cls}${ev.source === "email" ? " auto" : ""}" data-ev="${ev.id}" style="${style}" title="${esc(evLabel(ev))}" aria-label="${esc(evLabel(ev))}">${icon(ev.type, 12)}<span class="std-ev-t">${esc(text)}</span></button>`;
  }

  function renderCalendar() {
    const { y, m } = S.month, t = today(), evs = filtered();
    $("#std-month").textContent = L.monthTitle(y, m);
    const head = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<span class="std-wd">${d}</span>`).join("");
    const weeks = L.monthWeeks(y, m).map((days) => {
      const w = L.layoutWeek(days, evs);
      const rows = `auto ${"22px ".repeat(w.lanes)}minmax(44px, auto)`;
      const bg = days.map((d) => `<span class="std-cell${d === t ? " today" : ""}${Number(d.slice(5, 7)) - 1 !== m ? " out" : ""}"></span>`).join("");
      const nums = days.map((d, i) => {
        const n = evs.filter((e) => e.start_date <= d && L.endOf(e) >= d).length;
        return `<button type="button" class="std-daynum${d === t ? " today" : ""}${Number(d.slice(5, 7)) - 1 !== m ? " out" : ""}" data-day="${d}" style="grid-column:${i + 1};grid-row:1" aria-label="${esc(L.fmtDay(d))}, ${n} date${n === 1 ? "" : "s"}">${Number(d.slice(8))}${d.endsWith("-01") ? ` <span class="std-mon">${L.fmtDay(d, false).split(" ")[1]}</span>` : ""}</button>`;
      }).join("");
      const bars = w.bars.map((b) => {
        const p = projectOf(b.ev.project_id);
        return chip(b.ev, `bar${b.fromPrev ? " from-prev" : ""}${b.toNext ? " to-next" : ""}`, `grid-column:${b.col + 1} / span ${b.span};grid-row:${2 + b.lane}`,
          `${abbr(p?.pao_id)} · ${p?.title || ""} · ${L.typeOf(b.ev.type).short}`);
      }).join("");
      const points = w.points.map((list, i) => {
        if (!list.length) return "";
        const more = list.length - MAX_PER_DAY;
        return `<div class="std-points" style="grid-column:${i + 1};grid-row:${2 + w.lanes}">${list.slice(0, MAX_PER_DAY).map((ev) => {
          const p = projectOf(ev.project_id);
          return chip(ev, "pt", "", `${abbr(p?.pao_id)} · ${ev.title || L.typeOf(ev.type).short}`);
        }).join("")}${more > 0 ? `<button type="button" class="std-more" data-day="${days[i]}">+${more} more</button>` : ""}</div>`;
      }).join("");
      return `<div class="std-week" style="grid-template-rows:${rows}"><div class="std-week-bg" aria-hidden="true">${bg}</div>${nums}${bars}${points}</div>`;
    }).join("");
    $("#std-cal").innerHTML = `<div class="std-cal"><div class="std-weekdays">${head}</div>${weeks}</div>`;

    const up = L.upcoming(evs, t, 8);
    $("#std-upcoming").innerHTML = up.length ? up.map((ev) => {
      const p = projectOf(ev.project_id), open = L.isPeriod(ev) && ev.start_date <= t;
      return `<li><button type="button" class="std-up" data-ev="${ev.id}">
        <span class="std-dot t-${ev.type}">${icon(ev.type, 13)}</span>
        <span class="std-up-main"><b>${esc(abbr(p?.pao_id))}</b> · ${esc(p?.title || "")}<span class="muted small"> — ${esc(L.typeOf(ev.type).label)}${ev.title ? ` · ${esc(ev.title)}` : ""}</span></span>
        <span class="std-up-when small">${esc(L.fmtRange(ev.start_date, ev.end_date))}<span class="muted"> · ${open ? `closes ${esc(L.relative(L.endOf(ev), t))}` : esc(L.relative(ev.start_date, t))}</span></span></button></li>`;
    }).join("") : `<li class="muted small">${S.events.length ? "Nothing coming up with these filters." : "No dates yet. Add a standard, then its dates - or they appear here as emails from the standard setters are read."}</li>`;
  }

  // ---------- by standard ----------
  const STATUS_CHIP = { done: ["Finished", "ok"], withdrawn: ["Withdrawn", ""] };

  function stageLine(p) {
    const t = today(), nodes = L.stageLine(eventsOf(p.id), t);
    const STATE = { done: "Done", current: "Happening now", upcoming: "Coming up", empty: "No date yet", missed: "No date recorded" };
    return `<ol class="std-stages" aria-label="Progress of ${esc(p.title)}">${nodes.map((n) => {
      const date = n.kind === "event" ? L.fmtRange(n.start, n.period ? n.end : null) : "";
      const body = `${icon(n.type, 26)}${n.state === "done" ? `<span class="std-check" aria-hidden="true">✓</span>` : ""}`;
      const label = `${n.label}: ${STATE[n.state]}${date ? `, ${date}` : ""}`;
      const node = n.kind === "event"
        ? `<button type="button" class="std-node" data-ev="${n.ev.id}" aria-label="${esc(label)}">${body}</button>`
        : canEdit() ? `<button type="button" class="std-node" data-add-for="${esc(p.id)}" data-add-type="${esc(n.type)}" aria-label="${esc(label)}. Add a date">${body}</button>`
          : `<span class="std-node" role="img" aria-label="${esc(label)}">${body}</span>`;
      return `<li class="std-stage s-${n.state} t-${n.type}${n.next ? " next" : ""}${n.kind === "event" && n.ev.source === "email" ? " auto" : ""}">${node}
        <span class="std-stage-label">${esc(n.label)}</span>
        <span class="std-stage-date">${n.kind === "event" ? esc(date) : `<span class="muted">${n.state === "missed" ? "Not recorded" : "Not yet"}</span>`}</span>
        ${n.kind === "event" && n.ev.title ? `<span class="std-stage-note small muted">${esc(n.ev.title)}</span>` : ""}</li>`;
    }).join("")}</ol>`;
  }

  function renderStandards() {
    const t = today();
    const box = $("#std-standards");
    const groups = S.setters.filter((s) => (!S.paos.size || S.paos.has(s.id)) && (s.active !== false || S.projects.some((p) => p.pao_id === s.id)));
    const shown = groups.flatMap((s) => S.projects.filter((p) => p.pao_id === s.id && (!S.project || p.id === S.project)));
    box.innerHTML = (shown.length > 1 ? `<div class="std-bulk"><button type="button" class="btn small" data-fold-all="open">Expand all</button><button type="button" class="btn small" data-fold-all="close">Collapse all</button>
      <span class="muted small">${shown.length} standards. Open one to see its progress line.</span></div>` : "") + groups.map((s) => {
      let list = S.projects.filter((p) => p.pao_id === s.id && (!S.project || p.id === S.project));
      const rank = (p) => (p.status === "active" ? 0 : 1);
      list = list.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
      const open = list.filter((p) => L.summary(eventsOf(p.id), t).tone === "open").length;
      const cards = list.map((p) => {
        const sum = L.summary(eventsOf(p.id), t), st = STATUS_CHIP[p.status];
        const nodes = L.stageLine(eventsOf(p.id), t), done = nodes.filter((n) => n.kind === "event" && n.state === "done").length;
        // folded: the name, where it stands, a row of dots (one per step, filled when done) and the buttons; open: the full progress line
        return `<article class="panel std-card" data-project="${esc(p.id)}"><details class="std-fold" data-card="${esc(p.id)}"${S.openCards.has(p.id) ? " open" : ""}>
          <summary class="std-card-head">
            <span class="std-card-main"><h4>${safeUrl(p.url) ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.title)}</a>` : esc(p.title)}</h4>
              <span class="std-sum tone-${sum.tone}">${esc(sum.text)}</span>
              ${p.description ? `<span class="std-desc muted small">${esc(p.description)}</span>` : ""}</span>
            <span class="std-mini" role="img" aria-label="${done} of ${nodes.length} steps done">${nodes.map((n) => `<i class="s-${n.state} t-${n.type}"></i>`).join("")}</span>
            <span class="std-card-tools">${st ? `<span class="chip ${st[1]}">${st[0]}</span>` : ""}${p.source === "email" ? `<span class="chip" title="Found in an email by the daily collection">From email</span>` : ""}
              ${canEdit() ? `<button type="button" class="btn small" data-add-for="${esc(p.id)}">+ Add date</button><button type="button" class="btn ghost small" data-edit-standard="${esc(p.id)}">Edit</button>` : ""}</span>
          </summary>
          ${p.description ? `<p class="muted small std-desc-full">${esc(p.description)}</p>` : ""}
          <div class="table-wrap std-stage-wrap">${stageLine(p)}</div></details></article>`;
      }).join("");
      return `<details class="std-pao" data-setter="${esc(s.id)}"${list.length && !S.closedSetters.has(s.id) ? " open" : ""}><summary><h3>${esc(s.abbr || s.id)} <span class="muted small">${esc(s.name || "")}</span></h3>
        <span class="chip">${list.length} standard${list.length === 1 ? "" : "s"}</span>${open ? `<span class="chip ok">${open} open for comment</span>` : ""}</summary>
        ${cards || `<p class="muted small std-empty">Nothing tracked yet${canEdit() ? ` - use <b>+ Add standard</b>` : ""}.</p>`}</details>`;
    }).join("") || `<p class="muted">No standard setters to show.</p>`;
  }

  function render() {
    if ($("#standards-view").hidden) return;
    $("#std-error").hidden = !S.error;
    $("#std-error").textContent = S.error;
    for (const b of $$(".std-edit-only")) b.hidden = !canEdit() || !!S.error;
    renderFilters();
    $("#std-type-row").hidden = S.view !== "calendar";   // the kinds of date only filter the calendar
    $("#std-calendar").hidden = S.view !== "calendar";
    $("#std-standards").hidden = S.view !== "standards";
    if (S.view === "calendar") renderCalendar(); else renderStandards();
  }

  // ---------- dialogs ----------
  const who = (p) => abbr(p.pao_id);
  function detail(evId) {
    const ev = S.events.find((e) => String(e.id) === String(evId)); if (!ev) return;
    const p = projectOf(ev.project_id), ty = L.typeOf(ev.type);
    const by = ev.source === "email" ? `Read from an email by the daily collection. Please check the date.` : `Added by ${esc(ev.created_by || "a team member")}`;
    $("#std-detail").innerHTML = `
      <h2><span class="std-dot t-${ev.type}">${icon(ev.type, 16)}</span> ${esc(ty.label)}</h2>
      <dl class="std-dl">
        <dt>Standard</dt><dd>${esc(p ? `${who(p)}: ${p.title}` : "")}</dd>
        <dt>${L.isPeriod(ev) ? "Open" : "Date"}</dt><dd>${esc(L.fmtRange(ev.start_date, ev.end_date))}</dd>
        ${ev.title ? `<dt>Label</dt><dd>${esc(ev.title)}</dd>` : ""}
        ${ev.notes ? `<dt>Notes</dt><dd class="std-notes">${esc(ev.notes)}</dd>` : ""}
        ${safeUrl(ev.url) ? `<dt>Link</dt><dd><a href="${esc(ev.url)}" target="_blank" rel="noopener">${esc(ev.url.length > 70 ? ev.url.slice(0, 67) + "…" : ev.url)}</a></dd>` : ""}
        <dt>Source</dt><dd>${by}</dd>
      </dl>
      <div class="dialog-actions">
        ${canEdit() ? `<button class="btn" type="button" data-edit-date="${ev.id}">Edit</button>${ev.source === "email" ? `<button class="btn" type="button" data-checked="${ev.id}">Looks right</button>` : ""}` : ""}
        <button class="btn primary" type="button" data-close>Close</button>
      </div>`;
    openDialog("#std-detail-dialog");
  }
  function dayList(day) {
    const list = filtered().filter((e) => e.start_date <= day && L.endOf(e) >= day);
    $("#std-detail").innerHTML = `<h2>${esc(L.fmtDay(day))}</h2>
      ${list.length ? `<ul class="std-daylist">${list.map((ev) => { const p = projectOf(ev.project_id);
        return `<li><button type="button" class="std-up" data-ev="${ev.id}"><span class="std-dot t-${ev.type}">${icon(ev.type, 13)}</span>
          <span class="std-up-main"><b>${esc(abbr(p?.pao_id))}</b> · ${esc(p?.title || "")}<span class="muted small"> — ${esc(L.typeOf(ev.type).label)}${L.isPeriod(ev) ? ` (${esc(L.fmtRange(ev.start_date, ev.end_date))})` : ""}</span></span></button></li>`; }).join("")}</ul>`
        : `<p class="muted">Nothing on this day.</p>`}
      <div class="dialog-actions">${canEdit() && S.projects.length ? `<button class="btn" type="button" data-add-on="${day}">+ Add a date on this day</button>` : ""}<button class="btn primary" type="button" data-close>Close</button></div>`;
    openDialog("#std-detail-dialog");
  }
  function openDialog(sel) { const d = $(sel); if (!d.open) d.showModal(); }

  // add / edit a standard
  let editingProject = null;
  function standardDialog(id) {
    editingProject = id ? projectOf(id) : null;
    const f = $("#std-standard-form");
    f.pao_id.innerHTML = S.setters.map((s) => `<option value="${esc(s.id)}">${esc(s.abbr || s.id)} - ${esc(s.name || "")}</option>`).join("");
    f.pao_id.value = editingProject?.pao_id || (S.paos.size === 1 ? [...S.paos][0] : S.setters[0]?.id || "");
    f.title.value = editingProject?.title || ""; f.url.value = editingProject?.url || "";
    f.description.value = editingProject?.description || ""; f.status.value = editingProject?.status || "active";
    $("#std-standard-title").textContent = editingProject ? "Edit standard" : "Add a standard";
    $("#std-standard-delete").hidden = !editingProject;
    openDialog("#std-standard-dialog");
  }
  // add / edit a date
  let editingEvent = null;
  function syncEnd() {
    const f = $("#std-date-form"), period = L.typeOf(f.type.value).period || !!f.end_date.value;
    $("#std-end-wrap").hidden = !period;
    $("#std-start-label").textContent = L.typeOf(f.type.value).period ? "First day" : "Date";
    if (!period) f.end_date.value = "";
  }
  function dateDialog({ id, project, type, day } = {}) {
    editingEvent = id ? S.events.find((e) => String(e.id) === String(id)) : null;
    const f = $("#std-date-form");
    const byPao = S.setters.map((s) => ({ s, list: S.projects.filter((p) => p.pao_id === s.id) })).filter((g) => g.list.length);
    f.project_id.innerHTML = byPao.map((g) => `<optgroup label="${esc(g.s.abbr || g.s.id)}">${g.list.map((p) => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join("")}</optgroup>`).join("");
    f.type.innerHTML = L.TYPES.map((t) => `<option value="${t.key}">${esc(t.label)}</option>`).join("");
    f.project_id.value = editingEvent?.project_id || project || S.project || f.project_id.options[0]?.value || "";
    f.type.value = editingEvent?.type || type || "meeting";
    f.title.value = editingEvent?.title || ""; f.start_date.value = editingEvent?.start_date || day || "";
    f.end_date.value = editingEvent?.end_date || ""; f.url.value = editingEvent?.url || ""; f.notes.value = editingEvent?.notes || "";
    $("#std-date-title").textContent = editingEvent ? "Edit date" : "Add a date";
    $("#std-date-delete").hidden = !editingEvent;
    $("#std-date-msg").textContent = "";
    syncEnd();
    openDialog("#std-date-dialog");
  }

  async function refresh(msg) {
    try { await load(); } catch (e) { S.error = `Couldn't load the Project Tracker: ${e.message}`; }
    render();
    if (msg) A.toast(msg);
  }
  const fail = (e) => A.toast(missing(e) ? NEEDS_UPDATE : (/row-level|permission|denied/i.test(e.message) ? "Your role can't change the Project Tracker. Ask an admin to tick 'Add items' for you." : `Couldn't save: ${e.message}`), true);

  function wireDialogs() {
    $("#std-standard-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, act = e.submitter?.value, dlg = $("#std-standard-dialog");
      if (act === "cancel") return dlg.close();
      try {
        if (act === "delete") {
          if (!confirm(`Delete "${editingProject.title}" and all of its dates? This can't be undone.`)) return;
          await write("std_projects", "delete", null, editingProject.id); dlg.close(); return refresh("Standard deleted");
        }
        const v = { pao_id: f.pao_id.value, title: f.title.value.trim(), url: f.url.value.trim() || null, description: f.description.value.trim() || null, status: f.status.value, updated_at: new Date().toISOString() };
        if (editingProject) await write("std_projects", "update", v, editingProject.id);
        else await write("std_projects", "insert", { ...v, id: L.newId(v.pao_id, v.title), source: "manual", created_by: me() });
        dlg.close(); refresh(editingProject ? "Standard saved" : "Standard added");
      } catch (err) { fail(err); }
    });
    $("#std-date-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, act = e.submitter?.value, dlg = $("#std-date-dialog"), msg = $("#std-date-msg");
      if (act === "cancel") return dlg.close();
      try {
        if (act === "delete") {
          if (!confirm("Delete this date? This can't be undone.")) return;
          await write("std_events", "delete", null, editingEvent.id); dlg.close(); return refresh("Date deleted");
        }
        const end = f.end_date.value || null;
        if (end && end < f.start_date.value) { msg.textContent = "The last day can't be before the first day."; return; }
        const v = { project_id: f.project_id.value, type: f.type.value, title: f.title.value.trim() || null, start_date: f.start_date.value, end_date: end,
          url: f.url.value.trim() || null, notes: f.notes.value.trim() || null, updated_at: new Date().toISOString() };
        // someone editing a date read from an email has checked it
        if (editingEvent) await write("std_events", "update", { ...v, source: "manual" }, editingEvent.id);
        else await write("std_events", "insert", { ...v, source: "manual", created_by: me() });
        S.month = { y: Number(v.start_date.slice(0, 4)), m: Number(v.start_date.slice(5, 7)) - 1 };   // show where it landed
        dlg.close(); refresh(editingEvent ? "Date saved" : "Date added");
      } catch (err) {
        msg.textContent = /duplicate|unique/i.test(err.message) ? "This standard already has that kind of date on those days." : "";
        if (!msg.textContent) fail(err);
      }
    });
    $("#std-date-form").type.addEventListener("change", syncEnd);
    $("#std-detail-dialog").addEventListener("click", async (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const dlg = $("#std-detail-dialog");
      if (b.matches("[data-close]")) return dlg.close();
      if (b.dataset.ev) return detail(b.dataset.ev);
      if (b.dataset.editDate) { dlg.close(); return dateDialog({ id: b.dataset.editDate }); }
      if (b.dataset.addOn) { dlg.close(); return dateDialog({ day: b.dataset.addOn }); }
      if (b.dataset.checked) {
        try { await write("std_events", "update", { source: "manual", updated_at: new Date().toISOString() }, S.events.find((x) => String(x.id) === b.dataset.checked).id); dlg.close(); refresh("Marked as checked"); }
        catch (err) { fail(err); }
      }
    });
  }

  // ---------- page wiring ----------
  const OTHER_VIEWS = [".filters", ".layout", "#brief-view", "#admin-view", "#status-view", "#ask-view"];
  async function open() {
    for (const sel of OTHER_VIEWS) document.querySelector(sel).hidden = true;
    $("#standards-view").hidden = false;
    window.scrollTo(0, 0);
    if (!S.loaded) { $("#std-cal").innerHTML = `<p class="summary">Loading…</p>`; }
    await refresh();
  }
  function close() {
    $("#standards-view").hidden = true;
    for (const sel of [".filters", ".layout"]) document.querySelector(sel).hidden = false;
  }

  function wire() {
    $("#standards-btn").addEventListener("click", open);
    $("#standards-back").addEventListener("click", close);
    $("#std-add-standard").addEventListener("click", () => standardDialog());
    $("#std-add-date").addEventListener("click", () => {
      if (!S.projects.length) return A.toast("Add a standard first, then its dates", true);
      dateDialog();
    });
    $("#std-filters").addEventListener("click", (e) => {
      const pao = e.target.closest("[data-pao]"), ty = e.target.closest("[data-type]"), vw = e.target.closest("[data-std-view]");
      if (pao) S.paos.has(pao.dataset.pao) ? S.paos.delete(pao.dataset.pao) : S.paos.add(pao.dataset.pao);
      else if (ty) S.types.has(ty.dataset.type) ? S.types.delete(ty.dataset.type) : S.types.add(ty.dataset.type);
      else if (vw) S.view = vw.dataset.stdView;
      else return;
      render();
    });
    $("#std-project").addEventListener("change", (e) => { S.project = e.target.value; render(); });
    const step = (n) => { const d = new Date(S.month.y, S.month.m + n, 1); S.month = { y: d.getFullYear(), m: d.getMonth() }; render(); };
    $("#std-prev").addEventListener("click", () => step(-1));
    $("#std-next").addEventListener("click", () => step(1));
    $("#std-today").addEventListener("click", () => { const d = new Date(); S.month = { y: d.getFullYear(), m: d.getMonth() }; render(); });
    $("#standards-view").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.ev) return detail(b.dataset.ev);
      if (b.dataset.day) return dayList(b.dataset.day);
      if (b.dataset.editStandard) return standardDialog(b.dataset.editStandard);
      if (b.dataset.foldAll) {
        S.openCards = new Set(b.dataset.foldAll === "open" ? S.projects.map((p) => p.id) : []);
        S.closedSetters = new Set();
        return renderStandards();
      }
      if (b.dataset.addFor) return dateDialog({ project: b.dataset.addFor, type: b.dataset.addType });
    });
    // remember what was opened or folded by hand ('toggle' doesn't bubble, so listen while it travels down)
    $("#std-standards").addEventListener("toggle", (e) => {
      const d = e.target;
      if (d.matches?.("details.std-fold")) d.open ? S.openCards.add(d.dataset.card) : S.openCards.delete(d.dataset.card);
      else if (d.matches?.("details.std-pao")) d.open ? S.closedSetters.delete(d.dataset.setter) : S.closedSetters.add(d.dataset.setter);
    }, true);
    wireDialogs();
  }
  wire();
  window.PAOStandards = { open, load: () => S, render };
})();
