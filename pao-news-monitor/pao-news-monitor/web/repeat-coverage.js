/* News tab: fold repeated coverage of one event.
 *
 * When an organisation hosts or joins a big event, the same event fills its list: WCOA 2026 in Seoul put about
 * 15 articles under KICPA and again under IFAC in one week. Nothing is wrong with them one by one, but together they
 * bury everything else. This file finds such runs and keeps the best few visible; the rest are folded into one
 * "+N more about WCOA" row that opens on a click. Nothing is deleted, hidden from the brief or changed in the database:
 * it only changes how the list is laid out, and it can be switched off ("Fold repeated coverage").
 *
 * What counts as one event, per organisation:
 *   - a named event listed in EVENTS below (WCOA, also in Korean and as "Olympics of accountants"): folds from 3 articles, 1 stays visible, or
 *   - a capitalised name (4-8 capitals, like WCOA or ASEAN) used in at least MIN_GROUP of that organisation's headlines.
 *     Names of organisations, the usual standard-setter and accounting acronyms (STOP) and shouty all-capitals headlines
 *     never count.
 * Never folded: anything staff marked High or Medium, anything with a note, and leadership / contact change notices.
 * No DOM in here, so it can be tested with plain Node.
 */
(() => {
  "use strict";

  const MIN_GROUP = 5;     // fewer repeats than this are left alone
  const KEEP = 3;          // how many of a group stay visible
  const MIN_FOLDED = 2;    // folding one article would be pointless

  // known events: key, what to call it, how to recognise it in a headline.
  // A known event folds sooner than a guessed one: from `min` articles, and only `keep` stay visible.
  const EVENTS = [
    { key: "WCOA", label: "WCOA (World Congress of Accountants)", min: 3, keep: 1,
      re: /\bWCOA\b|world congress of accountants|world accountants conference|olympics of accountants|세계회계사대회|회계사 올림픽/i },
  ];

  // capitalised words that are NOT events: standard setters, regulators, and common abbreviations
  const STOP = new Set(("IFRS IASB ISSB IFAC IAASB IESBA IPSASB IPAE CAPA ASEAN APAC AFA SAFA ESG AI GAAP IPSAS ISA ISQM ISSA PAO PAOS CPA CPAS NEWS FAQ " +
    "COVID AGM EGM CEO CFO ACCA CIMA ICAEW ICAS AICPA CPD CPE SME SMEs IESBA FRC PCAOB IOSCO OECD IMF ADB WTO UN USA UK EU ASIA PACIFIC").split(/\s+/));

  const words = (s) => (String(s || "").match(/\b[A-Z]{4,8}\b/g) || []);
  const shouty = (title) => {
    const letters = String(title || "").replace(/[^A-Za-z]/g, "");
    return letters.length > 6 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.6;
  };

  const LEVEL = { high: 3, medium: 2, low: 1, none: 0 };
  const eff = (it) => it.relevance || it.ai_relevance || null;

  /** Items that must always stay visible. */
  function pinned(it, kindOf) {
    const kind = kindOf ? kindOf(it) : it.kind;
    return ["high", "medium"].includes(it.relevance) || !!(it.notes && it.notes.trim()) || kind === "leadership" || kind === "contact" || it.source === "page_watch";
  }

  /** The event each foldable item belongs to: { itemId: {key, label} }, only for events with enough items. */
  function events(items, ctx = {}) {
    const known = new Set([...(ctx.paoAbbrs || [])].map((a) => String(a).toUpperCase()));
    for (const w of words(ctx.ownName || "")) known.add(w);
    const pool = items.filter((it) => !pinned(it, ctx.kindOf));
    const hits = new Map();                                     // key -> {label, ids}
    const add = (key, label, it) => { if (!hits.has(key)) hits.set(key, { label, ids: [] }); hits.get(key).ids.push(it.id); };
    for (const it of pool) {
      const t = it.title || "";
      for (const e of EVENTS) if (e.re.test(t)) add(e.key, e.label, it);
      if (shouty(t)) continue;
      for (const w of new Set(words(t))) {
        if (STOP.has(w) || known.has(w) || EVENTS.some((e) => e.key === w)) continue;
        add(w, w, it);
      }
    }
    const out = {};
    const minFor = (key) => EVENTS.find((e) => e.key === key)?.min ?? MIN_GROUP;
    for (const [key, h] of [...hits].filter(([k, h]) => h.ids.length >= minFor(k)).sort((a, b) => b[1].ids.length - a[1].ids.length)) {
      for (const id of h.ids) if (!(id in out)) out[id] = { key, label: h.label };
    }
    return out;
  }

  /**
   * One organisation's list (already in display order) -> { shown, groups }.
   * shown = the items to list as usual; groups = [{key, label, items}] folded away. Only items the page would show anyway.
   */
  function fold(items, ctx = {}) {
    const ev = events(items, ctx);
    const byKey = new Map();
    for (const it of items) if (ev[it.id]) { const k = ev[it.id].key; if (!byKey.has(k)) byKey.set(k, { key: k, label: ev[it.id].label, items: [] }); byKey.get(k).items.push(it); }
    const hidden = new Set(), groups = [];
    for (const g of byKey.values()) {
      const ranked = g.items.slice().sort((a, b) => (b.relevance ? 1 : 0) - (a.relevance ? 1 : 0)      // staff-reviewed first
        || (LEVEL[eff(b)] ?? -1) - (LEVEL[eff(a)] ?? -1) || String(b.published_at || b.first_seen_at || "").localeCompare(String(a.published_at || a.first_seen_at || "")));
      const keep = new Set(ranked.slice(0, EVENTS.find((e) => e.key === g.key)?.keep ?? KEEP).map((it) => it.id));
      const folded = g.items.filter((it) => !keep.has(it.id));
      if (folded.length < MIN_FOLDED) continue;
      for (const it of folded) hidden.add(it.id);
      groups.push({ key: g.key, label: g.label, items: folded });
    }
    return { shown: items.filter((it) => !hidden.has(it.id)), groups };
  }

  const api = { fold, events, pinned, EVENTS, MIN_GROUP, KEEP };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.RepeatCoverage = api;
})();
