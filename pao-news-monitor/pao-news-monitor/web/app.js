/* PAO News Monitor - web page.
 * Shows every PAO (even with nothing found), the items found for it,
 * and lets the team mark relevance, set a category and write notes.
 */
(() => {
  "use strict";
  const CFG = window.PAO_CONFIG || {};
  const DEMO = !CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY;
  const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js";
  const SOURCE_LABEL = { website: "Website", google_news: "Google News", newsapi: "NewsAPI", email: "Email", manual: "Added by team", page_watch: "Page watch" };
  const THEME_LABEL = { ai_digital: "AI & digital", talent: "Talent", sustainability: "Sustainability", ethics_standards: "Ethics & standards" };
  const ALL_PERMS = ["tag_items","add_items","remove_items","edit_briefs","approve_briefs","send_briefs","manage_mailing_list","manage_members","ask_ai"];
  const can = (p) => state.role === "admin" || (state.perms || []).includes(p);
  const RELEVANCE_LABEL = { high: "High", medium: "Medium", low: "Low", none: "No relevance" };
  const KIND_LABEL = { news: "News", events: "Event", publications: "Publication", articles: "Newsletter / article", comment: "Opportunity to comment", leadership: "Leadership change", contact: "Contact change" };
  const GROUP_ORDER = ["Member", "Associate", "Affiliate", "Stakeholder", "Regional network", "Inbox"];
  const GROUP_LABEL = { Member: "Members", Associate: "Associates", Affiliate: "Affiliates", Stakeholder: "Stakeholders", "Regional network": "Regional network", Inbox: "Inbox" };
  const STALE_DAYS = 60;
  const NOTE_FILTER_KEY = "pao-news-filters";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // what kind of email link brought us here (read before Supabase tidies the address bar)
  const LINK = (() => {
    const h = new URLSearchParams(location.hash.replace(/^#/, "")), q = new URLSearchParams(location.search);
    return { type: h.get("type") || q.get("type") || "", error: h.get("error_description") || q.get("error_description") || "" };
  })();
  const state = { paos: [], items: [], health: [], lastRun: null, user: null, loadedSince: undefined, role: "team", perms: [], open: new Set(),
    date: { preset: "30" }, cal: { month: null, pending: null, hover: null }, openFolds: new Set(), selPao: "", selItem: "", showEmpty: false, sort: "new", closedGrps: new Set(), paoQ: "" };
  let db = null;

  // ---------- data layer ----------
  const api = {
    async init() {
      if (DEMO) {
        const res = await fetch("demo-data.json");
        this.demo = await res.json();
        state.user = { email: "demo@example.org" };
        state.role = "admin";
        state.perms = ALL_PERMS.slice();
        return true;
      }
      await loadScript(SUPABASE_JS);
      db = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
      const { data } = await db.auth.getSession();
      state.user = data.session?.user || null;
      db.auth.onAuthStateChange((event, session) => {
        const had = !!state.user;
        state.user = session?.user || null;
        if (event === "PASSWORD_RECOVERY") setTimeout(() => openPassword("recovery"), 0);
        if (!had && state.user) start();
        if (had && !state.user) showLogin();
      });
      return !!state.user;
    },
    async loadRole() {
      if (DEMO || !state.user) return;
      const { data, error } = await db.rpc("my_role");
      state.role = error ? "team" : (data || "team");   // database not updated yet: everyone is team
      const p = await db.rpc("my_permissions");
      state.perms = !p.error && Array.isArray(p.data) ? p.data      // before update-8: built-in defaults
        : state.role === "admin" ? ALL_PERMS.slice() : state.role === "team" ? ["tag_items", "add_items", "edit_briefs"] : [];
    },
    async signIn(email, password) {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signUp(email, password) {
      const { data, error } = await db.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
      if (error) throw error;
      // an existing account comes back with no identities (and no email is sent)
      return { exists: !data.session && Array.isArray(data.user?.identities) && data.user.identities.length === 0, session: !!data.session };
    },
    async forgot(email) {
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) throw error;
    },
    async setPassword(password) {
      if (DEMO) return;
      const { error } = await db.auth.updateUser({ password });
      if (error) throw error;
    },
    async signOut() { if (db) await db.auth.signOut(); },
    async load(sinceIso) {
      if (DEMO) {
        const d = this.demo;
        return { paos: d.paos, health: d.health, lastRun: d.runs.at(-1), items: d.items };
      }
      const [paos, health, runs] = await Promise.all([
        db.from("paos").select("*").eq("active", true).order("sort_order"),
        db.from("source_health").select("*"),
        db.from("runs").select("*").order("id", { ascending: false }).limit(1),
      ]);
      for (const r of [paos, health, runs]) if (r.error) throw r.error;
      const BASE = "id,pao_id,source,title,url,published_at,snippet,source_name,language,is_baseline,first_seen_at,relevance,category,notes,reviewed_by,reviewed_at";
      const tries = [BASE + ",kind,ai_summary,ai_themes,removed_at,removed_by,ai_relevance,ai_relevance_reason,original_title", BASE + ",kind,ai_summary,ai_themes,removed_at,removed_by,ai_relevance,ai_relevance_reason", BASE + ",kind,ai_summary,ai_themes,removed_at,removed_by", BASE + ",kind,ai_summary,ai_themes", BASE + ",kind", BASE];   // newer columns first; older databases fall back
      let cols = tries.shift();
      const items = [];
      for (let from = 0; ; from += 1000) {
        let q = db.from("items").select(cols).order("first_seen_at", { ascending: false }).range(from, from + 999);
        if (sinceIso) q = q.or(`first_seen_at.gte.${sinceIso},published_at.gte.${sinceIso}`);
        const { data, error } = await q;
        if (error && tries.length && /column|schema cache/i.test(error.message)) {  // database not updated yet
          cols = tries.shift(); from -= 1000; continue;
        }
        if (error) throw error;
        items.push(...data);
        if (data.length < 1000) break;
      }
      return { paos: paos.data, health: health.data, lastRun: runs.data[0], items };
    },
    // AI usage log (update-22.sql). Returns { rows } or { error } - a missing table is not a crash.
    async usage(sinceIso, untilIso) {
      if (DEMO) return { rows: (this.demo.usage || []).filter((r) => r.at >= sinceIso && r.at < untilIso) };
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from("ai_usage").select("at,feature,model,prompt_tokens,completion_tokens")
          .gte("at", sinceIso).lt("at", untilIso).order("at", { ascending: true }).range(from, from + 999);
        if (error) return { error: error.message || String(error) };
        rows.push(...data);
        if (data.length < 1000) break;
      }
      return { rows };
    },
    async content(id) {
      if (DEMO) return this.demo.items.find((i) => i.id === id)?.content || "";
      const { data, error } = await db.from("items").select("content").eq("id", id).single();
      if (error) throw error;
      return data.content || "";
    },
    async update(id, patch) {
      if (DEMO) return;
      const { error } = await db.from("items").update(patch).eq("id", id);
      if (error) throw error;
    },
    async remove(id, on) {
      if (DEMO) return;
      const { error } = await db.rpc("remove_item", { item_id: id, remove: on });
      if (error) throw error;
    },
    async deleteForever(ids) {   // ids null = every removed item
      if (DEMO) return (ids || []).length;
      const { data, error } = await db.rpc("delete_items_forever", { item_ids: ids });
      if (error) throw error;
      return data;
    },
    async insert(row) {
      if (DEMO) return;
      const { error } = await db.from("items").insert(row);
      if (error) throw error;
    },
  };

  function loadScript(src) {
    return new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = src; s.onload = ok; s.onerror = () => fail(new Error("Could not load " + src));
      document.head.appendChild(s);
    });
  }

  // ---------- filters ----------
  function filters() {
    return {
      period: state.date.preset || "custom", from: state.date.from || null, to: state.date.to || null,
      status: $("#f-status").value,
      sources: $$("input[name=src]:checked").map((i) => i.value).concat("_seen_pw"),
      kinds: $$("input[name=kind]:checked").map((i) => i.value).concat("_seen_cm"),
      baseline: $("#f-baseline").checked,
      fold: $("#f-fold").checked,
      q: $("#f-search").value.trim().toLowerCase(),
    };
  }
  function saveFilters() {
    try { localStorage.setItem(NOTE_FILTER_KEY, JSON.stringify(filters())); } catch { /* private mode */ }
  }
  function restoreFilters() {
    let f = null;
    try { f = JSON.parse(localStorage.getItem(NOTE_FILTER_KEY) || "null"); } catch { /* ignore */ }
    if (!f) return;
    if (f.period === "custom" && f.from && f.to) state.date = { from: f.from, to: f.to };
    else if (f.period && PRESETS[f.period]) state.date = { preset: f.period };
    // ignore a saved choice that no longer exists (e.g. the old "Country-specific only")
    if (f.status && $(`#f-status option[value="${f.status}"]`)) $("#f-status").value = f.status;
    // "page_watch" is new: tick it for people whose saved filters predate it
    if (Array.isArray(f.sources)) $$("input[name=src]").forEach((i) => (i.checked = f.sources.includes(i.value) || (i.value === "page_watch" && !f.sources.includes("_seen_pw"))));
    // "comment" is new: tick it for people whose saved filters predate it
    if (Array.isArray(f.kinds)) $$("input[name=kind]").forEach((i) => (i.checked = f.kinds.includes(i.value) || (i.value === "comment" && !f.kinds.includes("_seen_cm"))));
    $("#f-baseline").checked = !!f.baseline;
    $("#f-fold").checked = f.fold !== false;   // on unless someone switched it off
  }
  // what an item is: saved by the collector, or guessed from its address for older items
  function kindOf(it) {
    if (it.kind) return it.kind;
    if (it.source === "page_watch") return "leadership";
    if (it.source === "website" && it.url) {
      let path = it.url;
      try { path = new URL(it.url).pathname; } catch { /* keep */ }
      if (/\/(events?|seminars?|webinars?|conferences?|workshops?|cpd|cpe)(\/|-|_|\b)/i.test(path)) return "events";
      if (/\/(newsletters?|e-?newsletters?|articles?|blogs?|insights?|opinions?|columns?)(\/|-|_|\b)/i.test(path)) return "articles";
      if (/\/(publications?|journals?|magazines?|reports?|library|resources)(\/|-|_|\b)|\.pdf($|\?)/i.test(it.url)) return "publications";
    }
    return "news";
  }
  const kindGroup = (k) => (k === "leadership" || k === "contact" ? "changes" : k);
  const itemDate = (it) => it.published_at || it.first_seen_at;
  // staff label if someone reviewed it, otherwise the AI's suggestion (supabase/update-14.sql)
  const eff = (it) => it.relevance || it.ai_relevance || null;
  // ---------- dates: quick ranges or a calendar range ----------
  const PRESETS = { "1": "Last 24 hours", "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days", "365": "Last 12 months", all: "All time" };
  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;   // local calendar day
  const fromKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  // {since, until, custom}: ISO bounds for the chosen dates (until is exclusive)
  function dateRange(f) {
    if (f.period === "custom" && f.from && f.to) {
      const until = fromKey(f.to); until.setDate(until.getDate() + 1);
      return { since: fromKey(f.from).toISOString(), until: until.toISOString(), custom: true };
    }
    if (!f.period || f.period === "all" || !PRESETS[f.period]) return { since: null, until: null };
    return { since: new Date(Date.now() - Number(f.period) * 864e5).toISOString(), until: null };
  }
  function dateLabel() {
    const d = state.date;
    if (d.preset) return PRESETS[d.preset];
    const fmt = (k, withYear) => fromKey(k).toLocaleDateString(undefined, { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
    const sameYear = d.from.slice(0, 4) === d.to.slice(0, 4) && d.from.slice(0, 4) === String(new Date().getFullYear());
    return d.from === d.to ? fmt(d.from, !sameYear) : `${fmt(d.from, false)} – ${fmt(d.to, !sameYear)}`;
  }

  function visible(it, f, rng = {}) {
    if (!f.sources.includes(it.source)) return false;
    if (!f.kinds.includes(kindGroup(kindOf(it)))) return false;
    if (f.status === "removed") return !!it.removed_at;   // the bin: only removed items, nothing else applies
    if (it.removed_at) return false;
    if (it.is_baseline && !f.baseline) return false;
    if (rng.custom) {
      // calendar range: the item's own date (what the calendar counts show)
      const d = itemDate(it);
      if (!d || d < rng.since || d >= rng.until) return false;
    } else if (rng.since && !(itemDate(it) >= rng.since || it.first_seen_at >= rng.since)) {
      return false;   // quick ranges: published in it, or newly found by us in it
    }
    if (f.status === "hide_not" && eff(it) === "none") return false;
    if (f.status === "unreviewed" && it.relevance) return false;
    if (f.status === "reviewed" && !it.relevance) return false;
    if (f.status === "ai_unchecked" && (it.relevance || !it.ai_relevance)) return false;
    if (f.status === "ai_low_check" && (it.relevance || !["low", "none"].includes(it.ai_relevance))) return false;
    if (f.status === "high_med" && !["high", "medium"].includes(eff(it))) return false;
    if (["high", "medium", "low", "none"].includes(f.status) && eff(it) !== f.status) return false;
    if (f.q) {
      const hay = `${it.title} ${translations[it.id] || ""} ${it.ai_summary || ""} ${it.snippet || ""} ${it.notes || ""} ${it.category || ""} ${it.source_name || ""}`.toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    return true;
  }

  // ---------- formatting ----------
  function fmtDate(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }
  function ago(iso) {
    if (!iso) return "never";
    const m = (Date.now() - new Date(iso)) / 6e4;
    if (m < 60) return `${Math.max(1, Math.round(m))} min ago`;
    if (m < 1440) return `${Math.round(m / 60)} h ago`;
    return `${Math.round(m / 1440)} d ago`;
  }
  const FOREIGN_WORDS = /\b(le|la|les|des|du|et|pour|sur|dans|une|aux|au|par|vers|avec|est|el|los|las|del|para|und|der|die|das|dan|yang|untuk)\b/gi;
  function nonEnglish(it) {
    const lang = it.language || state.paos.find((p) => p.id === it.pao_id)?.lang || "";
    if (lang && !lang.startsWith("en")) return true;
    if (/[^\u0000-\u024F\u2000-\u206F\u20A0-\u20CF]/.test(it.title)) return true;   // non-Latin script
    const words = (it.title.match(FOREIGN_WORDS) || []).length;
    return words >= 2 || (words >= 1 && /[\u00C0-\u00FF]/.test(it.title));
  }
  const realSnippet = (it) => (it.snippet && !it.snippet.startsWith("Search: ") && it.source !== "page_watch" ? it.snippet : "");
  // Google News links are Google redirects that its page translator refuses, so translate the text instead
  // ---- headline translation in place (Google Translate) ----
  const TR_KEY = "pao-news-translations";
  const translations = (() => { try { return JSON.parse(localStorage.getItem(TR_KEY) || "{}"); } catch { return {}; } })();
  const showingEnglish = new Set();
  async function translateTitle(it) {
    if (translations[it.id]) return translations[it.id];
    const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=" + encodeURIComponent(it.title);
    const res = await fetch(url);
    if (!res.ok) throw new Error("Google Translate returned " + res.status);
    const data = await res.json();
    const text = (data[0] || []).map((seg) => seg[0]).join("").trim();
    if (!text) throw new Error("no translation returned");
    translations[it.id] = text;
    try {
      const keys = Object.keys(translations);
      if (keys.length > 3000) delete translations[keys[0]];
      localStorage.setItem(TR_KEY, JSON.stringify(translations));
    } catch { /* private mode / storage full: keep in memory only */ }
    return text;
  }
  const shownTitle = (it) => (showingEnglish.has(it.id) && translations[it.id]) || it.title;
  let editingTitle = null;   // id of the item whose title is being corrected
  const textTranslateUrl = (it) =>
    `https://translate.google.com/?sl=auto&tl=en&op=translate&text=${encodeURIComponent((it.title + "\n\n" + realSnippet(it)).trim().slice(0, 4000))}`;
  const pageTranslateUrl = (url) => `https://translate.google.com/translate?sl=auto&tl=en&u=${encodeURIComponent(url)}`;
  const canTranslatePage = (it) => it.url && (it.source === "website" || it.source === "page_watch") && !/news\.google\.com/.test(it.url);

  function healthFor(paoId) {
    const rows = state.health.filter((h) => h.pao_id === paoId);
    return ["website", "page_watch", "google_news"].map((src) => {
      const h = rows.find((r) => r.source === src);
      if (!h) return src === "page_watch" ? null : { src, level: "none", text: "not run yet" };
      let level = h.status === "ok" ? "ok" : h.status === "warning" ? "warn" : h.status === "error" ? "error" : "none";
      let text = h.message || h.status;
      if (src === "website" && h.status !== "skipped" && h.last_success_at) {
        const since = h.last_new_at || h.last_success_at;
        if ((Date.now() - new Date(since)) / 864e5 > STALE_DAYS && level === "ok") {
          level = "warn";
          text = `No new links for ${STALE_DAYS}+ days - check the site still works. ${text}`;
        }
      }
      if (h.status === "error" && h.consecutive_failures > 1) text = `Failed ${h.consecutive_failures} runs in a row. ${text}`;
      return { src, level, text, when: h.last_run_at };
    }).filter(Boolean);
  }
  function worstLevel(hs) {
    for (const l of ["error", "warn", "ok"]) if (hs.some((h) => h.level === l)) return l;
    return "none";
  }

  // ---------- rendering ----------
  // The News tab: PAOs on the left, their articles on the right as compact rows. One row opens at a time (click it,
  // or J / K) to show the snippet, category, notes and the other actions. Everything is handled in wire().
  const SEGMENTS = [["hide_not", "All", "all"], ["unreviewed", "To review", "todo"], ["reviewed", "Reviewed", "done"]];
  const SORT_KEY = "pao-news-sort";
  let paoById = new Map();
  let navCtx = null;       // what the left list needs to redraw itself while you type in "Find a PAO"
  let foldOn = true;

  function render() {
    const f = filters();
    const rng = dateRange(f);
    foldOn = f.fold && !f.q && f.status !== "removed";   // searching and the bin always show everything
    const free = { ...f, status: "all" };                // every filter except the status one, for the tab counts
    const byPao = new Map(state.paos.map((p) => [p.id, []]));
    const cnt = new Map(state.paos.map((p) => [p.id, { all: 0, todo: 0, done: 0 }]));
    for (const it of state.items) {
      const list = byPao.get(it.pao_id);
      if (!list) continue;
      if (visible(it, f, rng)) list.push(it);
      if (f.status !== "removed" && visible(it, free, rng)) {
        const c = cnt.get(it.pao_id);
        if (eff(it) !== "none") c.all++;
        if (it.relevance) c.done++; else c.todo++;
      }
    }
    const dir = state.sort === "old" ? 1 : -1;
    const bySort = (a, b) => dir * (itemDate(a) || "").localeCompare(itemDate(b) || "");
    for (const list of byPao.values()) list.sort(bySort);
    paoById = new Map(state.paos.map((p) => [p.id, p]));
    if (state.selPao && !paoById.has(state.selPao)) state.selPao = "";
    const sel = state.selPao ? paoById.get(state.selPao) : null;
    const pool = sel ? byPao.get(sel.id) : [...byPao.values()].flat().sort(bySort);
    if (state.selItem && !pool.some((i) => i.id === state.selItem)) state.selItem = "";

    const cats = [...new Set((CFG.CATEGORIES || []).concat(state.items.map((i) => i.category).filter(Boolean)))];
    const keep = { nav: $(".src-list")?.scrollTop || 0, feed: $(".feed-list")?.scrollTop || 0 };
    const focused = document.activeElement?.closest?.("#main") ? document.activeElement.dataset?.fk : null;
    const findHad = document.activeElement?.classList?.contains("src-find");

    navCtx = { byPao, cnt, pool };
    const main = $("#main");
    main.innerHTML = `<datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>`
      + navHtml() + feedHtml(sel, pool, byPao, cnt, f);
    if ($(".src-list")) $(".src-list").scrollTop = keep.nav;
    if ($(".feed-list")) $(".feed-list").scrollTop = keep.feed;
    $(`#main .art.open`)?.scrollIntoView({ block: "nearest" });
    if (focused) $(`#main [data-fk="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    if (findHad) { const i = $(".src-find"); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }
    updateMultiLabels();
    updateFilterBadge(f);
    renderCalendar();
  }

  // the "Filters" button says how many of the hidden filters are narrowing the list
  function updateFilterBadge(f) {
    const n = (["hide_not", "all", "unreviewed", "reviewed"].includes(f.status) ? 0 : 1)
      + $$(".nh-more .multi.narrowed").length + (f.baseline ? 1 : 0);
    const b = $("#filters-badge");
    b.hidden = !n; b.textContent = n;
  }

  const paoLabel = (p) => (p.abbr && p.abbr !== p.name ? p.abbr : p.name);
  const orderedPaos = () => GROUP_ORDER.flatMap((g) => state.paos.filter((p) => (p.grp || "Member") === g));

  // left: every PAO that has articles under the current filters (the rest fold into one link), with a plain count
  function navHtml() {
    return `<nav class="src-nav" aria-label="PAOs"><h3 class="src-title">PAOs</h3>
      <input class="src-find" type="search" placeholder="Find a PAO" aria-label="Find a PAO" value="${esc(state.paoQ)}" autocomplete="off">
      <div class="src-list">${navRows()}</div></nav>`;
  }
  function navRows() {
    const { byPao, pool } = navCtx;
    const q = state.paoQ.trim().toLowerCase();
    const total = [...byPao.values()].reduce((n, l) => n + l.length, 0);
    let hidden = 0;
    const rows = orderedPaos().filter((p) => {
      if (q && !`${p.abbr || ""} ${p.name} ${p.jurisdiction || ""}`.toLowerCase().includes(q)) return false;
      const keepIt = byPao.get(p.id).length || state.showEmpty || q || p.id === state.selPao;
      if (!keepIt) hidden++;
      return keepIt;
    }).map((p) => {
      const n = byPao.get(p.id).length;
      return `<button type="button" class="src-row" data-src="${esc(p.id)}"${state.selPao === p.id ? ' aria-current="true"' : ""} title="${esc(p.name)}">
        <span class="src-name">${esc(paoLabel(p))}</span><span class="src-count">${n}</span></button>`;
    }).join("");
    return `<button type="button" class="src-row src-all" data-src=""${state.selPao === "" ? ' aria-current="true"' : ""}><span class="src-name">All PAOs</span><span class="src-count">${total}</span></button>
      ${rows}${!q && (hidden || state.showEmpty) ? `<button type="button" class="link small src-empty" data-src-empty>${state.showEmpty ? "Hide PAOs with nothing found" : `Show ${hidden} with nothing found`}</button>` : ""}`;
  }

  // one article: a compact row (meta line, title, relevance pill); the open one also shows its details
  const REL_PILL = { high: "High", medium: "Medium", low: "Low", none: "No relevance" };
  function artHtml(it) {
    const open = it.id === state.selItem, ro = can("tag_items") ? "" : " disabled";
    const ai = it.ai_relevance;
    const meta = [it.source_name || SOURCE_LABEL[it.source] || it.source, kindOf(it) !== "news" ? KIND_LABEL[kindOf(it)] || kindOf(it) : "", itemDate(it) ? fmtDate(itemDate(it)) : ""].filter(Boolean).map(esc).join(" · ");
    const first = !it.relevance && ai ? `AI: ${RELEVANCE_LABEL[ai]}` : "To review";
    const pill = `<select class="rel-pick" data-fk="rel:${esc(it.id)}" data-lv="${esc(it.relevance || "")}" data-ai="${!it.relevance && ai ? "1" : ""}" aria-label="Relevance of this article"${ro}>
      <option value="">${it.relevance ? "To review" : first}</option>${Object.entries(REL_PILL).map(([v, t]) => `<option value="${v}"${it.relevance === v ? " selected" : ""}>${t}</option>`).join("")}</select>`;
    return `<li class="art${open ? " open" : ""}${it.relevance ? "" : " unrev"}" data-id="${esc(it.id)}">
      <div class="art-row">
        <button type="button" class="art-main" data-pick="${esc(it.id)}" data-fk="pick:${esc(it.id)}" aria-expanded="${open}">
          <span class="art-meta">${meta}</span><span class="art-title">${esc(shownTitle(it))}</span></button>
        ${pill}
        <button type="button" class="art-chev" data-pick="${esc(it.id)}" tabindex="-1" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>${open ? artBody(it, ro) : ""}</li>`;
  }

  function artBody(it, ro) {
    const ai = it.ai_relevance, aiLabel = RELEVANCE_LABEL[ai] || "";
    const reviewed = it.reviewed_by ? `<span class="muted small">Rated by ${esc(it.reviewed_by.split("@")[0])} ${ago(it.reviewed_at)}</span>` : "";
    const aiNote = !ai ? ""
      : !it.relevance ? `<p class="ai-rel" title="Suggested by AI">AI suggests <b>${esc(aiLabel)}</b>${it.ai_relevance_reason ? `: ${esc(it.ai_relevance_reason)}` : ""}
          ${can("tag_items") ? `<button type="button" class="btn small" data-accept="${esc(it.id)}">Accept ${esc(aiLabel)}</button>` : ""}</p>`
      : it.relevance !== ai ? `<p class="ai-rel overridden" title="The AI's original suggestion, kept for the record">AI suggested ${esc(aiLabel)}${it.ai_relevance_reason ? `: ${esc(it.ai_relevance_reason)}` : ""}</p>` : "";
    const themes = (it.ai_themes || []).filter((t) => THEME_LABEL[t]).map((t) => `<span class="theme" title="Theme tagged by AI">${THEME_LABEL[t]}</span>`).join("");
    return `<div class="art-body">
      ${editingTitle === it.id
        ? `<div class="title-edit"><input class="title-input" value="${esc(it.title)}" maxlength="500" aria-label="Title">
            <button class="btn primary small" type="button" data-title-save="${esc(it.id)}">Save</button>
            <button class="btn ghost small" type="button" data-title-cancel>Cancel</button></div>` : ""}
      <p class="art-facts muted small">${[SOURCE_LABEL[it.source] || it.source, it.is_baseline ? "first scan, may be old" : ""].filter(Boolean).map(esc).join(" · ")} ${themes}</p>
      ${it.original_title && it.original_title !== it.title ? `<p class="muted small" title="The title as it was first collected">Title corrected · was: ${esc(it.original_title)}</p>` : ""}
      ${it.ai_summary && nonEnglish(it) && !showingEnglish.has(it.id) ? `<p class="muted small ai-sum" title="One-line summary written by AI for the brief">In English: ${esc(it.ai_summary)}</p>` : ""}
      ${realSnippet(it) ? `<p class="art-snip">${esc(it.snippet)}</p>` : ""}
      ${it.source === "page_watch" && it.snippet ? `<p class="snippet diff">${esc(it.snippet)}</p><p class="muted small">Check the page before updating your records - a layout change can look like a new name.</p>` : ""}
      ${it.snippet && it.snippet.startsWith("Search: ") ? `<p class="muted small">Found by ${esc(it.snippet.toLowerCase())}</p>` : ""}
      ${it.source === "email" ? `<button class="link small" data-content="${esc(it.id)}" data-show="Show full email" data-hide="Hide email" type="button">Show full email</button><pre class="full" hidden></pre>` : ""}
      ${it.source === "page_watch" ? `<button class="link small" data-content="${esc(it.id)}" data-show="Show before / now" data-hide="Hide before / now" type="button">Show before / now</button><pre class="full" hidden></pre>` : ""}
      ${aiNote}
      <div class="art-fields">
        <label>Category <input class="cat" list="cats" value="${esc(it.category || "")}" placeholder="Category" aria-label="Category"${ro}></label>
        ${it.source !== "page_watch" ? `<label>Type <select class="kind-pick" aria-label="Type"${ro}>${["news", "events", "publications", "articles", "comment"].map((k) => `<option value="${k}"${kindOf(it) === k ? " selected" : ""}>${KIND_LABEL[k]}</option>`).join("")}</select></label>` : ""}
        <label class="grow">Notes <input class="notes" value="${esc(it.notes || "")}" placeholder="Add a note" aria-label="Notes"${ro}></label>
      </div>
      <div class="art-actions">
        ${it.url ? `<a class="link small" href="${esc(it.url)}" target="_blank" rel="noopener" title="Open the original (O)">Open source</a>` : ""}
        ${nonEnglish(it) ? `<button class="link small" type="button" data-translate="${esc(it.id)}" title="Show the headline in English (Google Translate)">${showingEnglish.has(it.id) ? "Show original" : "Translate"}</button>` : ""}
        ${nonEnglish(it) && canTranslatePage(it) ? `<a class="link small" href="${esc(pageTranslateUrl(it.url))}" target="_blank" rel="noopener" title="Open the whole page translated">Translate page</a>` : ""}
        ${can("tag_items") && editingTitle !== it.id ? `<button class="link small" type="button" data-title-edit="${esc(it.id)}" title="Correct a wrong or unclear title">Edit title</button>` : ""}
        ${can("tag_items") ? `<button class="link small" type="button" data-move="${esc(it.id)}" title="File this item under a different PAO">Move</button>` : ""}
        ${can("remove_items") ? (it.removed_at
          ? `<button class="link small" type="button" data-remove="${esc(it.id)}" data-on="0" title="Put it back on the tracker">Restore</button><button class="link small danger" type="button" data-forever="${esc(it.id)}" title="Delete it for good - it won't come back">Delete for good</button><span class="muted small">removed ${ago(it.removed_at)}${it.removed_by ? ` by ${esc(it.removed_by.split("@")[0])}` : ""}</span>`
          : `<button class="link small danger" type="button" data-remove="${esc(it.id)}" data-on="1" title="Hide this item everywhere - restore it from Filters > Show: Removed">Remove</button>`) : ""}
        ${reviewed}
        <button type="button" class="btn small art-done" data-pick="${esc(it.id)}">Done</button>
      </div>
    </div>`;
  }

  // Repeated coverage of one event (web/repeat-coverage.js): the best few stay in the list, the rest fold into one row.
  function paoRows(pid, items) {
    const RC = window.RepeatCoverage, p = paoById.get(pid);
    let shown = items, folded = [];
    if (foldOn && RC) ({ shown, groups: folded } = RC.fold(items, { paoAbbrs: state.paos.map((x) => x.abbr).filter(Boolean), ownName: `${p.abbr || ""} ${p.name || ""}`, kindOf }));
    const entries = shown.map((it) => ({ d: itemDate(it) || "", html: artHtml(it) }));
    for (const g of folded) {
      const id = `${pid}:${g.key}`;
      const open = state.openFolds.has(id) || g.items.some((i) => i.id === state.selItem);
      entries.push({ d: g.items.map(itemDate).filter(Boolean).sort().pop() || "", html: `<li class="item-fold"><details class="fold" data-fold="${esc(id)}"${open ? " open" : ""}>
        <summary>+${g.items.length} more about ${esc(g.label)}</summary><ul class="rows">${g.items.map(artHtml).join("")}</ul></details></li>` });
    }
    const dir = state.sort === "old" ? 1 : -1;
    return entries.sort((a, b) => dir * a.d.localeCompare(b.d)).map((e) => e.html).join("");
  }
  function feedRows(sel, pool) {
    const byP = new Map();
    for (const it of pool) { if (!byP.has(it.pao_id)) byP.set(it.pao_id, []); byP.get(it.pao_id).push(it); }
    if (sel) return `<ul class="rows">${paoRows(sel.id, byP.get(sel.id) || [])}</ul>`;
    return [...byP].map(([pid, items]) => {
      const p = paoById.get(pid);
      const open = !state.closedGrps.has(pid) || items.some((i) => i.id === state.selItem);
      return `<details class="grp" data-grp="${esc(pid)}"${open ? " open" : ""}><summary><span class="grp-name">${esc(paoLabel(p))}</span>
        <span class="grp-n">${items.length} ${items.length === 1 ? "article" : "articles"}</span></summary><ul class="rows">${paoRows(pid, items)}</ul></details>`;
    }).join("");
  }

  function feedHtml(sel, pool, byPao, cnt, f) {
    const scope = sel ? [sel] : state.paos;
    const tot = { all: 0, todo: 0, done: 0 };
    for (const p of scope) { const c = cnt.get(p.id); tot.all += c.all; tot.todo += c.todo; tot.done += c.done; }
    const n = pool.length, withNews = [...byPao.values()].filter((l) => l.length).length;
    const removedView = f.status === "removed";
    const jump = `<select class="pao-jump" aria-label="PAO"><option value="">All PAOs</option>${orderedPaos().filter((p) => byPao.get(p.id).length || p.id === state.selPao).map((p) => `<option value="${esc(p.id)}"${state.selPao === p.id ? " selected" : ""}>${esc(paoLabel(p))} (${byPao.get(p.id).length})</option>`).join("")}</select>`;
    const head = sel
      ? `<header class="feed-head">${jump}<h2>${esc(paoLabel(sel))}${sel.abbr && sel.abbr !== sel.name ? `<span class="pao-name">${esc(sel.name)}</span>` : ""}</h2>
          <p class="muted small">${[sel.jurisdiction ? esc(sel.jurisdiction) : "", sel.website ? `<a href="${esc(sel.website)}" target="_blank" rel="noopener">${esc(sel.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>` : "", sel.notes ? esc(sel.notes) : ""].filter(Boolean).join(" · ")}</p>
          <div class="pao-tools">
            ${sel.id === "_unmatched_email" ? "" : `<a class="link small" target="_blank" rel="noopener" title="Check LinkedIn by hand" href="https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(sel.name)}&sortBy=%22date_posted%22">LinkedIn</a>`}
            ${sel.facebook ? `<a class="link small" target="_blank" rel="noopener" title="Check their Facebook page by hand" href="${esc(sel.facebook)}">Facebook</a>` : ""}
            ${can("add_items") ? `<button class="link small" data-add="${esc(sel.id)}" type="button">+ Add item</button>` : ""}
          </div></header>`
      : `<header class="feed-head">${jump}<h2>All PAOs</h2><p class="muted small">${tot.todo ? `<b>${tot.todo} to review</b> · ` : ""}${n} ${n === 1 ? "article" : "articles"} across ${withNews} of ${state.paos.length} PAOs</p></header>`;
    const bar = removedView
      ? `<div class="feed-bar"><p class="small">Showing removed articles. ${n && can("remove_items") ? `<button class="btn small danger" type="button" data-forever-all>Delete all ${n} for good</button>` : ""}</p>
          <button type="button" class="btn small" data-seg="hide_not">Back to articles</button></div>`
      : `<div class="feed-bar"><div class="tabs" role="group" aria-label="Show">${SEGMENTS.map(([val, label, key]) => {
          const on = f.status === val || (val === "hide_not" && f.status === "all");
          return `<button type="button" data-seg="${val}" aria-pressed="${on}">${label} <span class="tab-n">${tot[key]}</span></button>`;
        }).join("")}</div>
        <label class="sort">Sort <select class="sort-pick" aria-label="Sort"><option value="new"${state.sort === "old" ? "" : " selected"}>Newest</option><option value="old"${state.sort === "old" ? " selected" : ""}>Oldest</option></select></label></div>`;
    const empty = f.status === "unreviewed" ? "Everything here has been reviewed." : "Nothing found for these filters. Try a longer date range.";
    return `<section class="feed" aria-label="Articles">${head}${bar}
      <div class="feed-list">${n ? feedRows(sel, pool) : `<p class="empty-note">${empty}</p>`}
        ${n && can("tag_items") ? `<p class="keys muted small"><kbd>J</kbd> <kbd>K</kbd> next / previous · <kbd>1</kbd> High <kbd>2</kbd> Medium <kbd>3</kbd> Low <kbd>4</kbd> No relevance · <kbd>O</kbd> open the original</p>` : ""}</div></section>`;
  }

  // the next article still to review after `id` (wrapping round), among the rows you can see
  const visibleIds = () => $$("#main .art-main[data-pick]").filter((el) => el.offsetParent !== null).map((el) => el.dataset.pick);
  function nextUnreviewed(id) {
    const ids = visibleIds(), at = ids.indexOf(id);
    const order = [...ids.slice(at + 1), ...ids.slice(0, Math.max(at, 0))];
    return order.find((x) => !state.items.find((i) => i.id === x)?.relevance) || "";
  }
  // open an article (one at a time); picking the open one again closes it
  function pick(id, { focus = false, toggle = false } = {}) {
    state.selItem = toggle && state.selItem === id ? "" : id;
    render();
    if (focus || toggle) $(`#main .art-main[data-pick="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }
  // rate an article; with `advance`, the first rating opens the next article still to review (keyboard and "Accept")
  function rate(id, value, { advance = false } = {}) {
    const it = state.items.find((i) => i.id === id);
    if (!it || !can("tag_items")) return;
    const next = value || null;
    if (advance && !it.relevance && next) { const nx = nextUnreviewed(id); if (nx) state.selItem = nx; }
    return save(id, { relevance: next });
  }

  // ---------- Scan type / News type dropdowns ----------
  // Small checkbox menus. The summary shows "All", "None", the single choice, or "3 of 6".
  function updateMultiLabels() {
    for (const d of $$(".multi:not(#date-pick)")) {
      const boxes = $$(".multi-panel input[name]", d);
      const on = boxes.filter((b) => b.checked);
      const text = on.length === boxes.length ? "All" : on.length === 0 ? "None"
        : on.length === 1 ? on[0].parentElement.textContent.trim() : `${on.length} of ${boxes.length}`;
      $(".multi-value", d).textContent = text;
      d.classList.toggle("narrowed", on.length !== boxes.length);
    }
  }

  // ---------- calendar ----------
  function setDates(next) {
    state.date = next; state.cal.pending = null; state.cal.hover = null;
    saveFilters();
    const since = dateRange(filters()).since;
    const needMore = state.loadedSince !== undefined && state.loadedSince !== null && (!since || since < state.loadedSince);
    needMore ? reload() : render();
  }

  function renderCalendar() {
    const box = $("#cal-months");
    if (!box) return;
    $("#date-value").textContent = dateLabel();
    $("#date-pick").classList.toggle("narrowed", !state.date.preset || state.date.preset !== "30");
    $$("[data-preset]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.preset === state.date.preset)));
    const today = new Date();
    if (!state.cal.month) {   // left month = the month before the selection's end (or before today)
      const end = state.date.to ? fromKey(state.date.to) : today;
      state.cal.month = new Date(end.getFullYear(), end.getMonth() - 1, 1);
    }
    // item counts per day, using every filter except the dates
    const f = filters(), counts = {};
    for (const it of state.items) {
      const d = itemDate(it);
      if (!d || !visible(it, f, {})) continue;
      const k = dayKey(new Date(d));
      counts[k] = (counts[k] || 0) + 1;
    }
    const loadedFrom = state.loadedSince ? dayKey(new Date(state.loadedSince)) : null;
    const todayKey = dayKey(today);
    let lo = null, hi = null;
    if (state.cal.pending) {
      const other = state.cal.hover || state.cal.pending;
      [lo, hi] = [state.cal.pending, other].sort();
    } else if (state.date.from) {
      [lo, hi] = [state.date.from, state.date.to];
    }
    const month = (first) => {
      const y = first.getFullYear(), m = first.getMonth();
      const days = new Date(y, m + 1, 0).getDate();
      let cells = "";
      for (let i = 0; i < first.getDay(); i++) cells += `<span class="cal-day empty"></span>`;
      for (let d = 1; d <= days; d++) {
        const k = `${y}-${pad(m + 1)}-${pad(d)}`;
        const future = k > todayKey;
        const cls = ["cal-day"];
        if (lo && k >= lo && k <= hi) cls.push("in-range");
        if (k === lo) cls.push("start");
        if (k === hi) cls.push("end");
        if (k === todayKey) cls.push("today");
        const known = !loadedFrom || k >= loadedFrom;
        const n = counts[k];
        const label = `${first.toLocaleDateString(undefined, { month: "long" })} ${d}${known && n ? `, ${n} item${n === 1 ? "" : "s"}` : ""}`;
        cells += `<button type="button" class="${cls.join(" ")}" data-day="${k}"${future ? " disabled" : ""} aria-label="${esc(label)}">`
          + `<span class="cal-num">${d}</span><span class="cal-count">${known && n ? n.toLocaleString() : ""}</span></button>`;
      }
      return `<div class="cal-month"><h3>${first.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h3>
        <div class="cal-grid">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => `<span class="cal-wd">${w}</span>`).join("")}${cells}</div></div>`;
    };
    const left = state.cal.month, right = new Date(left.getFullYear(), left.getMonth() + 1, 1);
    box.innerHTML = month(left) + month(right);
    $(".cal-nav.next").disabled = right.getFullYear() * 12 + right.getMonth() >= today.getFullYear() * 12 + today.getMonth();
    $("#cal-hint").textContent = state.cal.pending
      ? "Now click the end date (or the same day again for just that day)."
      : "Click a start date, then an end date. The small number is how many items are dated that day.";
  }

  function wireCalendar() {
    const panel = $("#date-pick");
    panel.addEventListener("toggle", () => {
      if (panel.open) { $$(".multi").forEach((o) => { if (o !== panel) o.open = false; }); state.cal.month = null; renderCalendar(); }
      else { state.cal.pending = null; state.cal.hover = null; }
    });
    panel.addEventListener("click", (e) => {
      if (e.target.closest(".cal-panel")) e.stopPropagation();   // the grid re-renders, so the page's "click outside" check can't tell
      const pre = e.target.closest("[data-preset]");
      if (pre) { setDates({ preset: pre.dataset.preset }); panel.open = false; return; }
      const nav = e.target.closest("[data-cal-nav]");
      if (nav) {
        const m = state.cal.month;
        state.cal.month = new Date(m.getFullYear(), m.getMonth() + Number(nav.dataset.calNav), 1);
        return renderCalendar();
      }
      const day = e.target.closest("[data-day]");
      if (!day || day.disabled) return;
      const k = day.dataset.day;
      if (!state.cal.pending) { state.cal.pending = k; state.cal.hover = k; return renderCalendar(); }
      const [from, to] = [state.cal.pending, k].sort();
      setDates({ from, to });
      panel.open = false;
    });
    $("#cal-months").addEventListener("mouseover", (e) => {
      const day = e.target.closest("[data-day]");
      if (!state.cal.pending || !day || day.dataset.day === state.cal.hover) return;
      state.cal.hover = day.dataset.day; renderCalendar();
    });
  }

  function renderHeader() {
    $("#user").textContent = (state.user?.email || "") + (state.role && state.role !== "team" ? ` (${state.role})` : "");
    document.body.dataset.role = state.role + ":" + state.perms.join(",");
    renderStatus();
  }

  // ---------- Status page: last run, the email inbox, and every source's health ----------
  const STATUS_SOURCES = ["website", "page_watch", "google_news"];
  const LEVEL_TEXT = { ok: "OK", warn: "Needs a look", error: "Failed", none: "Not run yet" };
  function renderStatus() {
    const r = state.lastRun;
    $("#st-last").textContent = r ? ago(r.finished_at) : "Not run yet";
    $("#st-last-sub").textContent = r ? `${r.summary?.new ?? 0} new items in that run` : "";
    const inbox = state.health.find((h) => h.pao_id === "_inbox" && h.source === "email");
    $("#st-inbox").textContent = !inbox ? "Not set up" : inbox.status === "error" ? "Failed" : inbox.status === "skipped" ? "Off" : "OK";
    $("#st-inbox-sub").textContent = inbox?.message || (inbox?.last_run_at ? `Checked ${ago(inbox.last_run_at)}` : "");

    const rows = state.paos.filter((p) => p.id !== "_unmatched_email" && p.active !== false)
      .map((p) => ({ p, hs: healthFor(p.id).filter((h) => STATUS_SOURCES.includes(h.src)) }));
    const issues = rows.flatMap(({ p, hs }) => hs.filter((h) => h.level === "error" || h.level === "warn").map((h) => ({ p, h })));
    $("#st-issues").textContent = issues.length ? String(issues.length) : "None";
    const countChip = $("#st-issues-count");
    countChip.textContent = issues.length ? String(issues.length) : "None";
    countChip.className = "chip " + (issues.some(({ h }) => h.level === "error") ? "error" : issues.length ? "warn" : "ok");
    $("#st-issues-list").innerHTML = issues.length
      ? issues.map(({ p, h }) => `<li class="status-item ${h.level}"><b>${esc(p.abbr || p.name)}</b> · ${esc(SOURCE_LABEL[h.src])}: ${esc(h.text)}${h.when ? ` <span class="muted small">(checked ${ago(h.when)})</span>` : ""}</li>`).join("")
      : `<li class="muted">Every source is running normally.</li>`;
    $("#st-table").innerHTML = `<thead><tr><th>Organisation</th>${STATUS_SOURCES.map((s) => `<th>${esc(SOURCE_LABEL[s])}</th>`).join("")}</tr></thead><tbody>` +
      rows.map(({ p, hs }) => `<tr><td>${esc(p.name)}</td>${STATUS_SOURCES.map((s) => {
        const h = hs.find((x) => x.src === s);
        if (!h) return `<td><span class="muted small">-</span></td>`;
        return `<td><span class="chip ${h.level}" title="${esc(h.text)}">${LEVEL_TEXT[h.level]}${h.when ? ` · ${ago(h.when)}` : ""}</span></td>`;
      }).join("")}</tr>`).join("") + "</tbody>";
  }

  // ---------- AI usage on the Admin tab (admins only): counts only (no questions or answers are ever stored) ----------
  const USAGE_LABEL = { ask: "Ask AI", relevance: "Daily relevance check", tagging: "Brief: tagging", explain: "Brief: highlight explanations", standards: "Projects Tracker: reading emails" };
  let usageData = null;
  const fmtTok = (n) => n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(Math.round(n));
  const fmtUsd = (v) => v === 0 ? "$0" : v < 0.01 ? "<$0.01" : "$" + v.toLocaleString("en-US", { minimumFractionDigits: v < 1 ? 3 : 2, maximumFractionDigits: v < 1 ? 3 : 2 });
  function usagePrice() {
    let p = { in: 0.10, out: 0.50 };
    try { const x = JSON.parse(localStorage.getItem("pao-usage-price") || "null"); if (x && x.in >= 0 && x.out >= 0) p = x; } catch (e) { /* storage blocked */ }
    return p;
  }
  // Period: any From/To dates (UTC, inclusive), so it can match a billing cycle. Default: the last 30 days.
  const ymd = (d) => d.toISOString().slice(0, 10);
  function usagePreset(kind) {
    const now = new Date(), y = now.getUTCFullYear(), m = now.getUTCMonth();
    let a, b = now;
    if (kind === "month") a = new Date(Date.UTC(y, m, 1));
    else if (kind === "lastmonth") { a = new Date(Date.UTC(y, m - 1, 1)); b = new Date(Date.UTC(y, m, 0)); }
    else a = new Date(now.getTime() - (Number(kind) - 1) * 864e5);
    $("#us-from").value = ymd(a); $("#us-to").value = ymd(b);
  }
  async function loadUsage() {
    if (!$("#us-from").value || !$("#us-to").value) usagePreset(30);
    let a = $("#us-from").value, b = $("#us-to").value;
    if (a > b) { [a, b] = [b, a]; $("#us-from").value = a; $("#us-to").value = b; }
    const days = [];
    for (let t = Date.parse(a + "T00:00:00Z"); t <= Date.parse(b + "T00:00:00Z"); t += 864e5) days.push(ymd(new Date(t)));
    const until = new Date(Date.parse(b + "T00:00:00Z") + 864e5).toISOString();
    usageData = { days, ...(await api.usage(a + "T00:00:00.000Z", until)) };
    renderUsage();
  }
  function renderUsage() {
    const u = usageData;
    if (!u) return;
    const pr = usagePrice();
    $("#us-pin").value = pr.in; $("#us-pout").value = pr.out;
    const note = $("#us-note");
    if (u.error) {
      note.className = "small usage-note-warn";
      note.textContent = /does not exist|schema cache|relation/i.test(u.error)
        ? "Usage isn't being logged yet. Run supabase/update-22.sql in Supabase, then the next AI answer will appear here."
        : "Couldn't load usage: " + u.error;
      for (const id of ["#us-cards", "#us-bars", "#us-axis", "#us-feature", "#us-model"]) $(id).innerHTML = "";
      return;
    }
    const rows = u.rows;
    if (!rows.length) {
      note.className = "muted small";
      note.textContent = "Nothing logged in this period yet. Each Ask AI answer, daily relevance check and brief adds a row.";
      for (const id of ["#us-cards", "#us-bars", "#us-axis", "#us-feature", "#us-model"]) $(id).innerHTML = "";
      return;
    }
    note.className = "muted small";
    note.textContent = "Requests and tokens the AI models have handled. Only counts are stored, never the questions, answers or article text.";
    const cost = (i, o) => i / 1e6 * pr.in + o / 1e6 * pr.out;
    const tot = rows.reduce((a, r) => ({ n: a.n + 1, i: a.i + (r.prompt_tokens || 0), o: a.o + (r.completion_tokens || 0) }), { n: 0, i: 0, o: 0 });
    // per day (UTC date), every day of the period shown
    const byDay = {};
    for (const r of rows) { const k = r.at.slice(0, 10); (byDay[k] ||= { n: 0, t: 0 }); byDay[k].n++; byDay[k].t += (r.prompt_tokens || 0) + (r.completion_tokens || 0); }
    const days = u.days;
    const max = Math.max(1, ...days.map((k) => byDay[k]?.t || 0));
    const busiest = days.reduce((b, k) => ((byDay[k]?.t || 0) > (byDay[b]?.t || 0) ? k : b), days[0]);
    $("#us-cards").innerHTML = [
      ["Requests", tot.n.toLocaleString("en-US"), `${(tot.n / u.days.length).toFixed(1)} a day on average over ${u.days.length} day${u.days.length > 1 ? "s" : ""}`],
      ["Tokens", fmtTok(tot.i + tot.o), `${fmtTok(tot.i)} in, ${fmtTok(tot.o)} out`],
      ["Estimated price", fmtUsd(cost(tot.i, tot.o)), `If paid at $${pr.in}/$${pr.out} per 1M tokens`],
      ["Busiest day", new Date(busiest + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }), `${fmtTok(byDay[busiest]?.t || 0)} tokens, ${byDay[busiest]?.n || 0} requests`],
    ].map(([a, b, c]) => `<div class="panel status-card"><span class="muted small">${a}</span><strong>${esc(b)}</strong><span class="muted small">${esc(c)}</span></div>`).join("");
    $("#us-bars").innerHTML = days.map((k) => {
      const d = byDay[k], label = new Date(k + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
      return d ? `<span class="us-bar" style="height:${Math.max(3, d.t / max * 100).toFixed(1)}%" title="${label}: ${fmtTok(d.t)} tokens, ${d.n} requests"></span>`
               : `<span class="us-bar zero" title="${label}: no requests"></span>`;
    }).join("");
    $("#us-bars").style.gap = days.length > 60 ? "0" : "";
    const yrs = days[0].slice(0, 4) !== days.at(-1).slice(0, 4);
    const short = (k) => new Date(k + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(yrs ? { year: "numeric" } : {}), timeZone: "UTC" });
    $("#us-axis").innerHTML = `<span>${short(days[0])}</span><span>${short(days.at(-1))}</span>`;
    const group = (keyFn, label) => {
      const g = {};
      for (const r of rows) { const k = keyFn(r); (g[k] ||= { n: 0, i: 0, o: 0 }); g[k].n++; g[k].i += r.prompt_tokens || 0; g[k].o += r.completion_tokens || 0; }
      return `<thead><tr><th>${label}</th><th>Requests</th><th>Tokens in</th><th>Tokens out</th><th>Estimated price</th></tr></thead><tbody>` +
        Object.entries(g).sort((a, b) => (b[1].i + b[1].o) - (a[1].i + a[1].o)).map(([k, v]) =>
          `<tr><td>${esc(USAGE_LABEL[k] || k)}</td><td>${v.n.toLocaleString("en-US")}</td><td>${fmtTok(v.i)}</td><td>${fmtTok(v.o)}</td><td>${fmtUsd(cost(v.i, v.o))}</td></tr>`).join("") + "</tbody>";
    };
    $("#us-feature").innerHTML = group((r) => r.feature, "What it was for");
    $("#us-model").innerHTML = group((r) => (r.model || "unknown").replace(/^[a-z]+:/, ""), "Model");
  }

  function openStatus() {
    for (const sel of [".filters", ".layout", "#brief-view", "#admin-view", "#ask-view", "#standards-view"]) document.querySelector(sel).hidden = true;
    $("#status-view").hidden = false;
    renderStatus();
    window.scrollTo(0, 0);
  }
  function closeStatus() {
    $("#status-view").hidden = true;
    for (const sel of [".filters", ".layout"]) document.querySelector(sel).hidden = false;
  }

  // the section buttons show which view is open
  function markNav() {
    const brief = !$("#brief-view").hidden, status = !$("#status-view").hidden, admin = !$("#admin-view").hidden, ask = !$("#ask-view").hidden, std = !$("#standards-view").hidden;
    for (const [id, on] of Object.entries({ "news-btn": !brief && !status && !admin && !ask && !std, "brief-btn": brief, "standards-btn": std, "ask-nav": ask, "status-btn": status })) {
      const el = $("#" + id);
      el.classList.toggle("active", on);
      if (on) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
    }
  }

  // ---------- actions ----------
  function toast(msg, bad) {
    const t = $("#toast");
    t.textContent = msg; t.className = "toast" + (bad ? " bad" : ""); t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500);
  }

  async function save(id, patch) {
    const it = state.items.find((i) => i.id === id);
    const before = { ...it };
    Object.assign(patch, { reviewed_by: state.user?.email || null, reviewed_at: new Date().toISOString() });
    Object.assign(it, patch);
    let ok = true;
    try { await api.update(id, patch); }
    catch (e) {
      ok = false; Object.assign(it, before);
      const denied = /permission denied/i.test(e.message);
      const msg = denied && "pao_id" in patch ? "Moving items needs a quick database update (supabase/update-9.sql) - ask your admin"
        : denied && "title" in patch ? "Editing titles needs a quick database update (supabase/update-18.sql) - ask your admin"
        : "Couldn't save: " + e.message;
      toast(msg, true);
    }
    // typing a category or note changes nothing in the lists, so don't redraw (a redraw between pressing and
    // releasing the mouse would swallow the click that made the box lose focus)
    const quiet = ok && Object.keys(patch).every((k) => ["category", "notes", "reviewed_by", "reviewed_at"].includes(k));
    if (!quiet) render();
    return ok;
  }

  async function saveTitle(id) {
    const input = $(`.art[data-id="${CSS.escape(id)}"] .title-input`);
    const it = state.items.find((i) => i.id === id);
    const val = (input?.value || "").replace(/\s+/g, " ").trim();
    if (!it) return;
    if (!val) { toast("A title can't be empty", true); return; }
    editingTitle = null;
    if (val === it.title) return render();
    const oldTitle = it.title;
    if (await save(id, { title: val })) {
      // mirror the database: keep the first title, drop the AI summary written from the old one
      if (!it.original_title) it.original_title = oldTitle;
      it.ai_summary = null; it.ai_themes = null;
      delete translations[id]; showingEnglish.delete(id);
      render(); toast("Title saved");
    }
  }

  async function reload() {
    const f = filters();
    const since = dateRange(f).since;
    // only refetch from the server when we need older items than we have
    $("#main").innerHTML = `<p class="summary">Loading…</p>`;
    try {
      const data = await api.load(since);
      Object.assign(state, data, { loadedSince: since });
      renderHeader(); render();
    } catch (e) {
      $("#main").innerHTML = `<p class="error-box">Couldn't load data: ${esc(e.message)}</p>`;
    }
  }

  function wire() {
    wireCalendar();
    for (const el of ["#f-status", "#f-baseline", "#f-fold"]) $(el).addEventListener("change", () => { saveFilters(); render(); });
    $$("input[name=src], input[name=kind]").forEach((i) => i.addEventListener("change", () => { saveFilters(); render(); }));
    let typing; $("#f-search").addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(render, 200); });
    // remember which PAOs are open ('toggle' doesn't bubble, so listen while it travels down)
    $("#main").addEventListener("toggle", (e) => {
      const d = e.target;
      if (d.matches?.("details.fold")) { d.open ? state.openFolds.add(d.dataset.fold) : state.openFolds.delete(d.dataset.fold); return; }
      if (d.matches?.("details.grp")) { d.open ? state.closedGrps.delete(d.dataset.grp) : state.closedGrps.add(d.dataset.grp); return; }
      if (!d.matches?.("details.pao")) return;
      d.open ? state.open.add(d.dataset.pao) : state.open.delete(d.dataset.pao);
    }, true);
    // top bar: News goes back from whichever view is open; Status opens its page
    $("#news-btn").addEventListener("click", () => {
      for (const sec of ["#brief-view", "#admin-view", "#status-view", "#ask-view", "#standards-view"]) {
        if (!$(sec).hidden) $(sec).querySelector("button[id$='-back']").click();
      }
    });
    $("#status-btn").addEventListener("click", openStatus);
    for (const id of ["#us-from", "#us-to"]) $(id).addEventListener("change", loadUsage);
    for (const b of $$("[data-us-preset]")) b.addEventListener("click", () => { usagePreset(b.dataset.usPreset); loadUsage(); });
    for (const id of ["#us-pin", "#us-pout"]) $(id).addEventListener("change", () => {
      const v = { in: Math.max(0, parseFloat($("#us-pin").value) || 0), out: Math.max(0, parseFloat($("#us-pout").value) || 0) };
      try { localStorage.setItem("pao-usage-price", JSON.stringify(v)); } catch (e) { /* storage blocked */ }
      renderUsage();
    });
    $("#status-back").addEventListener("click", closeStatus);
    for (const sec of ["#brief-view", "#admin-view", "#status-view", "#ask-view", "#standards-view"]) new MutationObserver(markNav).observe($(sec), { attributes: true, attributeFilter: ["hidden"] });
    // the profile menu closes after a choice, or when you click elsewhere
    $$(".profile-menu button").forEach((b) => b.addEventListener("click", () => ($("#profile").open = false)));
    document.addEventListener("click", (e) => { if ($("#profile").open && !$("#profile").contains(e.target)) $("#profile").open = false; });
    // a link to #pao-xyz (e.g. from the brief) shows that organisation's stories
    const openFromHash = () => {
      const m = location.hash.match(/^#pao-(.+)$/);
      if (!m) return;
      state.selPao = decodeURIComponent(m[1]); state.selItem = "";
      render();
    };
    window.addEventListener("hashchange", openFromHash);
    state.openFromHash = openFromHash;
    // dropdown menus: All / None buttons, close when clicking elsewhere or pressing Esc, one open at a time
    $$(".multi").forEach((d) => {
      d.addEventListener("toggle", () => { if (d.open) { $$(".multi").forEach((o) => { if (o !== d) o.open = false; }); $("#more-menu").open = false; } });
      d.addEventListener("click", (e) => {
        const b = e.target.closest("[data-multi]");
        if (!b) return;
        $$(".multi-panel input[name]", d).forEach((i) => (i.checked = b.dataset.multi === "all"));
        saveFilters(); render();
      });
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".multi")) $$(".multi[open]").forEach((d) => (d.open = false)); });
    // keyboard triage on the News tab: J/K (or the arrows on the list) move, 1-4 rate, O opens the original
    document.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || $(".layout").hidden || document.querySelector("dialog[open], .multi[open], .more[open]")) return;
      const t = e.target;
      if (t.closest?.("input, select, textarea, [contenteditable]")) return;
      const onRow = !!t.closest?.(".art-main");
      const key = e.key.toLowerCase();
      const step = key === "j" || (onRow && e.key === "ArrowDown") ? 1 : key === "k" || (onRow && e.key === "ArrowUp") ? -1 : 0;
      if (step) {
        const ids = visibleIds(); if (!ids.length) return;
        const at = ids.indexOf(state.selItem);
        e.preventDefault();
        return pick(ids[Math.min(ids.length - 1, Math.max(0, at < 0 ? (step > 0 ? 0 : ids.length - 1) : at + step))], { focus: true });
      }
      const cur = state.items.find((i) => i.id === state.selItem);
      if (!cur) return;
      const rating = { 1: "high", 2: "medium", 3: "low", 4: "none" }[e.key];
      if (rating) { e.preventDefault(); return rate(cur.id, cur.relevance === rating ? "" : rating, { advance: true }); }
      if (e.key === "Escape") { e.preventDefault(); return pick(cur.id, { toggle: true }); }
      if (key === "o" && cur.url) { e.preventDefault(); window.open(cur.url, "_blank", "noopener"); }
    });
    // the More menu closes when you pick something, click elsewhere, or press Escape (and never stays open beside a filter menu)
    const more = $("#more-menu");
    more.addEventListener("toggle", () => { if (more.open) $$(".multi[open]").forEach((d) => (d.open = false)); });
    more.addEventListener("click", (e) => { if (e.target.closest(".more-panel")) more.open = false; });
    document.addEventListener("click", (e) => { if (more.open && !more.contains(e.target)) more.open = false; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && more.open) { more.open = false; more.querySelector("summary").focus(); } });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") $$(".multi[open]").forEach((d) => (d.open = false)); });
    $("#refresh").addEventListener("click", reload);
    // "Find a PAO" narrows the left list as you type (only that list is redrawn, so the box keeps focus)
    $("#main").addEventListener("input", (e) => {
      if (!e.target.matches(".src-find")) return;
      state.paoQ = e.target.value;
      $(".src-list").innerHTML = navRows();
    });
    // the less-used filters sit behind one button
    $("#filters-toggle").addEventListener("click", () => {
      const open = $("#filters-more").hidden;
      $("#filters-more").hidden = !open;
      $("#filters-toggle").setAttribute("aria-expanded", String(open));
    });
    $("#export").addEventListener("click", exportCsv);
    $("#signout").addEventListener("click", async () => { await api.signOut(); if (DEMO) toast("Demo mode - nothing to sign out of"); });

    $("#main").addEventListener("click", async (e) => {
      const rel = e.target.closest("[data-rel]");
      if (rel) return rate(rel.closest(".art").dataset.id, rel.dataset.rel);
      const src = e.target.closest("[data-src]");
      if (src) { state.selPao = src.dataset.src; state.selItem = ""; return render(); }
      if (e.target.closest("[data-src-empty]")) { state.showEmpty = !state.showEmpty; return render(); }
      const row = e.target.closest("[data-pick]");
      if (row) return pick(row.dataset.pick, { toggle: true });
      const seg = e.target.closest("[data-seg]");
      if (seg) { $("#f-status").value = seg.dataset.seg; state.selItem = ""; saveFilters(); return render(); }
      const acc = e.target.closest("[data-accept]");
      if (acc) { const it = state.items.find((i) => i.id === acc.dataset.accept); return it && rate(it.id, it.ai_relevance, { advance: true }); }
      const add = e.target.closest("[data-add]");
      if (add) return openAdd(add.dataset.add);
      const rm = e.target.closest("[data-remove]");
      if (rm) {
        const it = state.items.find((i) => i.id === rm.dataset.remove);
        const on = rm.dataset.on === "1";
        const before = { removed_at: it.removed_at, removed_by: it.removed_by };
        Object.assign(it, on ? { removed_at: new Date().toISOString(), removed_by: state.user?.email || "demo" } : { removed_at: null, removed_by: null });
        render();
        try {
          await api.remove(it.id, on);
          toast(on ? "Removed - find it under Show: Removed to restore" : "Restored");
        } catch (err) {
          Object.assign(it, before); render();
          toast(/remove_item|function/i.test(err.message) ? "Removing needs a quick database update (supabase/update-10.sql) - ask your admin" : "Couldn't save: " + err.message, true);
        }
        return;
      }
      const fv = e.target.closest("[data-forever], [data-forever-all]");
      if (fv) {
        const all = fv.hasAttribute("data-forever-all");
        const ids = all ? state.items.filter((i) => i.removed_at).map((i) => i.id) : [fv.dataset.forever];
        if (!confirm(all ? `Delete all ${ids.length} removed items for good? This can't be undone.` : "Delete this item for good? This can't be undone.")) return;
        try {
          const n = await api.deleteForever(all ? null : ids);
          const gone = new Set(ids);
          state.items = state.items.filter((i) => !gone.has(i.id));
          render(); toast(`Deleted ${n ?? ids.length} item${(n ?? ids.length) === 1 ? "" : "s"} for good`);
        } catch (err) {
          toast(/delete_items_forever|function/i.test(err.message) ? "Deleting needs a quick database update (supabase/update-21.sql) - ask your admin" : "Couldn't delete: " + err.message, true);
        }
        return;
      }
      const te = e.target.closest("[data-title-edit]");
      if (te) {
        editingTitle = te.dataset.titleEdit; render();
        const input = $(`.art[data-id="${CSS.escape(editingTitle)}"] .title-input`);
        if (input) { input.focus(); input.select(); }
        return;
      }
      const ts = e.target.closest("[data-title-save]");
      if (ts) return saveTitle(ts.dataset.titleSave);
      if (e.target.closest("[data-title-cancel]")) { editingTitle = null; return render(); }
      const mv = e.target.closest("[data-move]");
      if (mv) {
        // swap the link for a PAO picker; choosing one moves the item
        const it = state.items.find((i) => i.id === mv.dataset.move);
        const sel = document.createElement("select");
        sel.className = "pao-pick";
        sel.setAttribute("aria-label", "Move to PAO");
        sel.innerHTML = `<option value="">Move to…</option>` + GROUP_ORDER.map((g) => {
          const ps = state.paos.filter((p) => (p.grp || "Member") === g && p.id !== it.pao_id);
          return ps.length ? `<optgroup label="${esc(g)}">${ps.map((p) => `<option value="${esc(p.id)}">${esc(p.abbr || p.name)}${p.jurisdiction ? ` (${esc(p.jurisdiction)})` : ""}</option>`).join("")}</optgroup>` : "";
        }).join("");
        sel.dataset.item = it.id;
        mv.replaceWith(sel);
        sel.focus();
        sel.addEventListener("blur", () => { if (!sel.value) render(); });
        return;
      }
      const tr = e.target.closest("[data-translate]");
      if (tr) {
        const it = state.items.find((i) => i.id === tr.dataset.translate);
        if (showingEnglish.has(it.id)) { showingEnglish.delete(it.id); return render(); }
        tr.textContent = "Translating…"; tr.disabled = true;
        try {
          await translateTitle(it);
          showingEnglish.add(it.id);
          render();
        } catch (err) {
          // Google refused (rare): fall back to opening Google Translate in a new tab
          tr.textContent = "Translate"; tr.disabled = false;
          toast("Couldn't translate here (" + err.message + ") - opening Google Translate instead", true);
          window.open(textTranslateUrl(it), "_blank", "noopener");
        }
        return;
      }
      const more = e.target.closest("[data-content]");
      if (more) {
        const pre = more.nextElementSibling;
        if (pre.hidden && !pre.textContent) {
          try { pre.textContent = await api.content(more.dataset.content) || "(empty)"; } catch (err) { toast(err.message, true); return; }
        }
        pre.hidden = !pre.hidden;
        more.textContent = pre.hidden ? more.dataset.show : more.dataset.hide;
      }
    });
    $("#main").addEventListener("keydown", (e) => {
      if (!e.target.matches(".title-input")) return;
      if (e.key === "Enter") { e.preventDefault(); saveTitle(e.target.closest(".art").dataset.id); }
      else if (e.key === "Escape") { editingTitle = null; render(); }
    });
    $("#main").addEventListener("change", (e) => {
      const el = e.target;
      if (el.matches(".rel-pick")) return rate(el.closest(".art").dataset.id, el.value);
      if (el.matches(".sort-pick")) { state.sort = el.value === "old" ? "old" : "new"; try { localStorage.setItem(SORT_KEY, state.sort); } catch { /* private mode */ } return render(); }
      if (el.matches(".pao-jump")) { state.selPao = el.value; state.selItem = ""; return render(); }
      if (el.matches(".kind-pick")) return save(el.closest(".art").dataset.id, { kind: el.value });
      if (el.matches(".pao-pick")) {
        if (!el.value) return render();
        const p = state.paos.find((x) => x.id === el.value);
        return save(el.dataset.item, { pao_id: el.value }).then((ok) => ok && toast(`Moved to ${p?.abbr || p?.name || el.value}`));
      }
      if (!el.matches(".cat, .notes")) return;
      const id = el.closest(".art").dataset.id;
      const field = el.classList.contains("cat") ? "category" : "notes";
      const val = el.value.trim() || null;
      const it = state.items.find((i) => i.id === id);
      if ((it[field] || null) !== val) save(id, { [field]: val });
    });

    // ---- sign in / first time / forgot password ----
    const HELP = {
      signin: ["Sign in with your work email and password.", "Sign in"],
      signup: ["An admin must have given your email access first. Choose a password; we'll email you once to confirm it's really you.", "Create my password"],
      forgot: ["We'll email you a link to set a new password. (Also use this if you used to sign in with email links and never had a password.)", "Email me a link"],
    };
    let mode = "signin";
    function setMode(m) {
      mode = m;
      $$(".login-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
      $("#login-help").textContent = HELP[m][0];
      $("#login-submit").textContent = HELP[m][1];
      $$("#login-form .pw").forEach((el) => (el.hidden = m === "forgot"));
      $$("#login-form .pw2").forEach((el) => (el.hidden = m !== "signup"));
      $("#login-password").required = m !== "forgot";
      $("#login-password2").required = m === "signup";
      $("#login-password").autocomplete = m === "signup" ? "new-password" : "current-password";
      $("#login-msg").textContent = "";
    }
    $$(".login-tabs button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    $("#login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = $("#login-msg"), email = $("#login-email").value.trim(), pw = $("#login-password").value;
      if (mode === "signup" && pw !== $("#login-password2").value) { msg.textContent = "The two passwords don't match."; return; }
      msg.textContent = mode === "signin" ? "Signing in…" : "Sending…";
      try {
        if (mode === "signin") {
          await api.signIn(email, pw);
          msg.textContent = "";
        } else if (mode === "signup") {
          const r = await api.signUp(email, pw);
          msg.textContent = r.exists ? "This email already has an account. Sign in, or use Forgot password to set a password."
            : r.session ? "" : "Almost done: check your email and click the confirmation link, then sign in here.";
        } else {
          await api.forgot(email);
          msg.textContent = "If that email has access, a link is on its way. Open it on this device to set your password.";
        }
      } catch (err) {
        const m = err.message || String(err);
        msg.textContent = /invalid login credentials/i.test(m) ? "Wrong email or password. First time here? Use the 'First time here' tab."
          : /email not confirmed/i.test(m) ? "Please click the confirmation link we emailed you first (check spam too)."
          : /not been given access|signups not allowed|not allowed/i.test(m) ? "This email hasn't been given access yet. Ask an admin to add you on the Admin tab."
          : /rate limit|too many/i.test(m) ? "Too many emails sent - please wait a few minutes and try again."
          : "Couldn't do that: " + m;
      }
    });
    if (LINK.error) { $("#login-msg").textContent = "That link didn't work (" + LINK.error.replace(/\+/g, " ") + "). Use Forgot password to get a new one."; }

    // ---- set / change password ----
    $("#password-btn").addEventListener("click", () => openPassword("change"));
    $("#pw-dialog").addEventListener("close", async () => {
      if ($("#pw-dialog").returnValue !== "save") return;
      const f = $("#pw-form");
      if (f.elements.p1.value !== f.elements.p2.value) { toast("The two passwords don't match", true); return openPassword(pwReason); }
      try { await api.setPassword(f.elements.p1.value); toast("Password saved. Next time, sign in with your email and password."); }
      catch (err) { toast("Couldn't save the password: " + err.message, true); openPassword(pwReason); }
    });
  }

  let pwReason = "change";
  function openPassword(reason) {
    pwReason = reason;
    const f = $("#pw-form"); f.reset();
    $("#pw-title").textContent = reason === "change" ? "Change your password" : "Set your password";
    $("#pw-cancel").textContent = reason === "change" ? "Cancel" : "Later";
    if (!$("#pw-dialog").open) $("#pw-dialog").showModal();
  }

  let addFor = null;
  function openAdd(paoId) {
    addFor = paoId;
    const p = state.paos.find((x) => x.id === paoId);
    $("#add-pao-name").textContent = p.abbr || p.name;
    $("#add-form").reset();
    $("#add-dialog").showModal();
  }
  $("#add-dialog").addEventListener("close", async () => {
    if ($("#add-dialog").returnValue !== "save" || !addFor) return;
    const fd = new FormData($("#add-form"));
    const now = new Date().toISOString();
    const row = {
      id: "manual-" + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)),
      pao_id: addFor, source: "manual", title: fd.get("title").trim(), url: fd.get("url").trim() || null,
      published_at: fd.get("date") ? new Date(fd.get("date") + "T00:00:00Z").toISOString() : null,
      notes: fd.get("notes").trim() || null, source_name: state.user?.email || "", first_seen_at: now, is_baseline: false,
    };
    try {
      await api.insert(row);
      state.items.unshift({ ...row, relevance: null, category: null });
      render(); toast("Added");
    } catch (e) { toast("Couldn't add: " + e.message, true); }
  });

  function exportCsv() {
    const f = filters(); const rng = dateRange(f);
    const paoById = new Map(state.paos.map((p) => [p.id, p]));
    const rows = state.items.filter((it) => paoById.has(it.pao_id) && visible(it, f, rng))
      .sort((a, b) => (paoById.get(a.pao_id).sort_order - paoById.get(b.pao_id).sort_order) || (itemDate(b) || "").localeCompare(itemDate(a) || ""));
    const head = ["PAO", "Organisation", "Jurisdiction", "Date", "Type", "Source", "Outlet / sender", "Title", "Title (English)", "Link", "Relevance", "AI suggestion", "AI reason", "Category", "Notes", "Reviewed by"];
    const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(cell).join(",")].concat(rows.map((it) => {
      const p = paoById.get(it.pao_id);
      return [p.abbr, p.name, p.jurisdiction, (itemDate(it) || "").slice(0, 10), KIND_LABEL[kindOf(it)], SOURCE_LABEL[it.source], it.source_name, it.title, translations[it.id] || "", it.url,
        RELEVANCE_LABEL[it.relevance] || "", RELEVANCE_LABEL[it.ai_relevance] || "", it.ai_relevance_reason, it.category, it.notes, it.reviewed_by].map(cell).join(",");
    }));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pao-news-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
    toast(`Exported ${rows.length} item${rows.length === 1 ? "" : "s"} (what's on screen now)`);
  }

  // ---------- start ----------
  function showLogin() { $("#app").hidden = true; $("#login").hidden = false; }
  async function start() {
    $("#login").hidden = true; $("#app").hidden = false;
    $("#demo-banner").hidden = !DEMO;
    await api.loadRole();
    if (LINK.type === "invite" || LINK.type === "recovery") { openPassword(LINK.type); LINK.type = ""; }
    await reload();
    state.openFromHash?.();
    // links from the other pages land on a view: index.html#brief, #ask, #status, #admin, #password
    const views = { "#brief": "#brief-btn", "#standards": "#standards-btn", "#ask": "#ask-nav", "#status": "#status-btn", "#admin": "#admin-btn" };
    if (views[location.hash]) $(views[location.hash]).click();
    if (location.hash === "#password") openPassword("change");
  }

  // keep section jumps clear of the sticky filter bar
  new ResizeObserver(([e]) => {
    const h = Math.ceil(e.target.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--filters-h", h + "px");
  }).observe($(".filters"));

  // shared with manage.js (Members, People, Import)
  window.PAOApp = { api, state, reload, render, toast, esc, loadUsage, get db() { return db; }, DEMO, CFG, kindLabel: KIND_LABEL, can, ALL_PERMS };

  // Wide tables scroll sideways. Keyboard users can only scroll them if the scroller can take focus.
  let scrollerCount = 0;
  const focusableScrollers = () => {
    for (const w of document.querySelectorAll(".table-wrap:not([tabindex])")) {
      w.tabIndex = 0;
      w.setAttribute("role", "region");
      w.setAttribute("aria-label", `${(w.closest(".panel")?.querySelector("h2, h3")?.textContent || "Table").trim()} table ${++scrollerCount}`);
    }
  };
  new MutationObserver(focusableScrollers).observe(document.body, { childList: true, subtree: true });
  focusableScrollers();

  restoreFilters();
  try { if (localStorage.getItem(SORT_KEY) === "old") state.sort = "old"; } catch { /* private mode */ }
  wire();
  api.init().then((signedIn) => (signedIn ? start() : showLogin())).catch((e) => {
    document.body.innerHTML = `<p class="error-box">Couldn't start: ${esc(e.message)}</p>`;
  });
})();
