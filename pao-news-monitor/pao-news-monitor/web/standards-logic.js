/* Standards tab - the rules, with no page code in here so they can be tested with plain Node.
 *
 * A standard (std_projects row) has dates (std_events rows). From those dates this file works out
 *   - the calendar: which dates are bars (a period, like an exposure draft's comment window) and which are
 *     small blocks (a meeting, an effective date), laid out week by week;
 *   - the progress line: four basic stages (Planning, Exposure draft & call for comments, Post-comments /
 *     meetings, Implementation) that fill in as dates are added, with an extra stage for every further date
 *     (a second call for comments, a third meeting ...). Nothing is "added by hand" to the line: the line IS the dates.
 * Dates are plain "YYYY-MM-DD" strings everywhere, so time zones can never move a date by a day.
 */
(() => {
  "use strict";

  // colour is a CSS class (.t-<key> in style.css); `period` = shown as a bar; `rank` = place in the basic four (null = no fixed place)
  const TYPES = [
    { key: "work_plan",         label: "Work plan / planning",               short: "Plan",      period: false, rank: 0 },
    { key: "exposure_draft",    label: "Exposure draft & call for comments", short: "ED",        period: true,  rank: 1 },
    { key: "call_for_comments", label: "Other call for comments",            short: "Comments",  period: true,  rank: 1 },
    { key: "meeting",           label: "Meeting",                            short: "Meeting",   period: false, rank: null },
    { key: "feedback_meeting",  label: "Meeting after comments",             short: "After comments", period: false, rank: 2 },
    { key: "issued",            label: "Standard issued",                    short: "Issued",    period: false, rank: 2.5 },
    { key: "implementation",    label: "Implementation / effective date",    short: "Effective", period: false, rank: 3 },
    { key: "other",             label: "Other",                              short: "Other",     period: false, rank: null },
  ];
  const TYPE = Object.fromEntries(TYPES.map((t) => [t.key, t]));
  const typeOf = (k) => TYPE[k] || TYPE.other;

  // the four stages every standard starts with; `types` = what fills the stage in
  const BASE = [
    { key: "work_plan",        label: "Planning / work plan",               types: ["work_plan"] },
    { key: "exposure_draft",   label: "Exposure draft & call for comments", types: ["exposure_draft", "call_for_comments"] },
    { key: "feedback_meeting", label: "Post-comments / meetings",           types: ["feedback_meeting"] },
    { key: "implementation",   label: "Implementation",                     types: ["implementation"] },
  ];

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // ---------- plain dates ----------
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;          // a local Date -> day
  const parts = (s) => String(s).slice(0, 10).split("-").map(Number);
  const utc = (s) => { const [y, m, d] = parts(s); return Date.UTC(y, m - 1, d); };
  const addDays = (s, n) => { const d = new Date(utc(s) + n * 86400000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const diffDays = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);                            // b - a
  const weekday = (s) => (new Date(utc(s)).getUTCDay() + 6) % 7;                                   // Monday = 0
  const endOf = (ev) => ev.end_date || ev.start_date;
  const isPeriod = (ev) => !!ev.end_date && ev.end_date > ev.start_date;

  const fmtDay = (s, withYear = true) => { const [y, m, d] = parts(s); return `${d} ${MONTHS[m - 1]}${withYear ? " " + y : ""}`; };
  function fmtRange(a, b) {
    if (!b || b === a) return fmtDay(a);
    const [ya] = parts(a), [yb] = parts(b);
    return ya === yb ? `${fmtDay(a, false)} – ${fmtDay(b)}` : `${fmtDay(a)} – ${fmtDay(b)}`;
  }
  function monthTitle(year, month0) { return `${MONTHS_LONG[month0]} ${year}`; }
  function relative(day, today) {
    const n = diffDays(today, day);
    if (n === 0) return "today";
    if (n === 1) return "tomorrow";
    if (n === -1) return "yesterday";
    return n > 0 ? `in ${n} days` : `${-n} days ago`;
  }

  // ---------- calendar ----------
  /** The weeks (Monday first) that show a month: [[7 day strings] x 4-6]. */
  function monthWeeks(year, month0) {
    const first = `${year}-${pad(month0 + 1)}-01`;
    let day = addDays(first, -weekday(first));
    const weeks = [];
    do {
      weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
      day = addDays(day, 7);
    } while (parts(day)[1] - 1 === month0 && parts(day)[0] === year || weeks.length < 4);
    return weeks;
  }

  const byStart = (a, b) => a.start_date.localeCompare(b.start_date) || endOf(a).localeCompare(endOf(b)) || String(a.id).localeCompare(String(b.id));

  /** One week row: bars (periods) with a lane each, and the one-day dates under each day. */
  function layoutWeek(days, events) {
    const first = days[0], last = days[6];
    const bars = [], points = days.map(() => []);
    const here = events.filter((e) => e.start_date <= last && endOf(e) >= first).slice().sort(byStart);
    const laneEnd = [];                                         // last column used in each lane
    for (const ev of here.filter(isPeriod).sort((a, b) => a.start_date.localeCompare(b.start_date) || endOf(b).localeCompare(endOf(a)))) {
      const col = Math.max(0, diffDays(first, ev.start_date));
      const end = Math.min(6, diffDays(first, endOf(ev)));
      let lane = laneEnd.findIndex((e) => e < col);
      if (lane < 0) lane = laneEnd.push(-1) - 1;
      laneEnd[lane] = end;
      bars.push({ ev, col, span: end - col + 1, lane, fromPrev: ev.start_date < first, toNext: endOf(ev) > last });
    }
    for (const ev of here.filter((e) => !isPeriod(e))) points[diffDays(first, ev.start_date)].push(ev);
    return { bars, lanes: laneEnd.length, points };
  }

  // ---------- filters and lists ----------
  /** events of the standards that pass the filters: { paos:Set (empty = all), project:id|"", types:Set (empty = all) } */
  function visible(events, projects, f = {}) {
    const byId = new Map(projects.map((p) => [p.id, p]));
    return events.filter((e) => {
      const p = byId.get(e.project_id);
      return p && (!f.paos || !f.paos.size || f.paos.has(p.pao_id)) && (!f.project || f.project === p.id)
        && (!f.types || !f.types.size || f.types.has(e.type));
    });
  }
  /** What needs a look next: periods open today first (soonest to close), then what starts next. */
  function upcoming(events, today, limit = 12) {
    const open = (e) => isPeriod(e) && e.start_date <= today;
    return events.filter((e) => endOf(e) >= today)
      .sort((a, b) => (open(b) - open(a)) || (open(a) ? endOf(a).localeCompare(endOf(b)) : a.start_date.localeCompare(b.start_date)) || byStart(a, b))
      .slice(0, limit);
  }

  // ---------- the progress line ----------
  const rankOf = (node) => (node.kind === "placeholder" ? node.rank : typeOf(node.type).rank);

  /**
   * The line for one standard: its dates in order, with any of the four basic stages that have no date yet
   * shown as empty steps in their usual place. Each step is done, current (today is inside it) or upcoming;
   * the first upcoming step is also `next`.
   */
  function stageLine(events, today) {
    const nodes = events.slice().sort(byStart).map((ev) => ({
      kind: "event", ev, type: ev.type, label: typeOf(ev.type).label, start: ev.start_date, end: endOf(ev), period: isPeriod(ev),
      state: endOf(ev) < today ? "done" : ev.start_date <= today ? "current" : "upcoming", next: false, auto: false,
    }));
    BASE.forEach((b, i) => {
      if (nodes.some((n) => n.kind === "event" && b.types.includes(n.type))) return;
      const at = nodes.findIndex((n) => rankOf(n) !== null && rankOf(n) > i);
      nodes.splice(at < 0 ? nodes.length : at, 0, { kind: "placeholder", rank: i, type: b.key, label: b.label, state: "empty", next: false });
    });
    // an empty step that sits before a finished one was simply never recorded; one after is still to come
    const lastDone = nodes.map((n) => n.state === "done" || n.state === "current").lastIndexOf(true);
    nodes.forEach((n, i) => { if (n.kind === "placeholder") n.state = i < lastDone ? "missed" : "empty"; });
    const next = nodes.find((n) => n.kind === "event" && n.state === "upcoming");
    if (next && !nodes.some((n) => n.state === "current")) next.next = true;
    return nodes;
  }

  /** One line about where a standard is: { text, tone: "open" | "soon" | "done" | "quiet" }. */
  function summary(events, today) {
    if (!events.length) return { text: "No dates yet", tone: "quiet" };
    const sorted = events.slice().sort(byStart);
    const open = sorted.find((e) => isPeriod(e) && e.start_date <= today && endOf(e) >= today);
    if (open) return { text: `${typeOf(open.type).label}: open until ${fmtDay(endOf(open))} (${relative(endOf(open), today)})`, tone: "open" };
    const impl = sorted.filter((e) => e.type === "implementation");
    if (impl.length && impl.every((e) => endOf(e) < today)) return { text: `In effect since ${fmtDay(impl[impl.length - 1].start_date)}`, tone: "done" };
    const next = sorted.find((e) => endOf(e) >= today);
    if (next) return { text: `Next: ${typeOf(next.type).label.toLowerCase()}, ${fmtRange(next.start_date, next.end_date)} (${relative(next.start_date < today ? today : next.start_date, today)})`, tone: "soon" };
    const issued = sorted.filter((e) => e.type === "issued").pop();
    const last = sorted[sorted.length - 1];
    return { text: issued ? `Issued ${fmtDay(issued.start_date)}; no later dates yet` : `Last date: ${typeOf(last.type).label.toLowerCase()}, ${fmtDay(endOf(last))}`, tone: "quiet" };
  }

  function newId(pao, title, rand = Math.random) {
    const slug = String(title || "standard").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "standard";
    return `${pao}-${slug}-${Math.floor(rand() * 36 ** 4).toString(36).padStart(4, "0")}`;
  }

  const api = { TYPES, TYPE, BASE, typeOf, ymd, addDays, diffDays, weekday, endOf, isPeriod, fmtDay, fmtRange, monthTitle, relative,
    monthWeeks, layoutWeek, visible, upcoming, stageLine, summary, newId, byStart };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.StdLogic = api;
})();
