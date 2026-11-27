"""News tab: repeated coverage of one event is folded (web/repeat-coverage.js). Runs the real JavaScript with Node."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

JS = Path(__file__).resolve().parent.parent / "web" / "repeat-coverage.js"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="Node.js not installed")

CTX = {"paoAbbrs": ["KICPA", "IFAC", "ICAI"], "ownName": "KICPA Korean Institute of Certified Public Accountants"}


def fold(items, ctx=CTX):
    script = f"const R = require({json.dumps(str(JS))}); const D = {json.dumps({'items': items, 'ctx': ctx})}; const r = R.fold(D.items, D.ctx); " \
             "console.log(JSON.stringify({shown: r.shown.map(i => i.id), groups: r.groups.map(g => ({key: g.key, label: g.label, ids: g.items.map(i => i.id)}))}))"
    out = subprocess.run(["node", "-e", script], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def item(i, title, **kw):
    return {"id": i, "title": title, "source": "google_news", "published_at": f"2026-11-{20 - i // 10:02d}T0{i % 10}:00:00+00:00", **kw}


def wcoa(n):
    titles = ["WCOA 2026 opens in Seoul", "World Congress of Accountants draws 5,000 delegates", "세계회계사대회 개막", "IFAC president speaks at WCOA",
              "Keynote at WCOA: AI and the profession", "Day 2 of WCOA 2026", "WCOA panel on sustainability assurance", "Seoul hosts world congress of accountants",
              "Closing ceremony of WCOA", "KICPA chair welcomes WCOA guests", "WCOA gala dinner", "WCOA youth forum", "What WCOA means for Korea", "WCOA wrap-up", "WCOA 2030 host announced"]
    return [item(i, titles[i % len(titles)] + ("" if i < len(titles) else f" ({i})")) for i in range(n)]


def test_fifteen_articles_about_one_event_become_one_and_a_fold():
    items = wcoa(15)
    r = fold(items)
    assert len(r["shown"]) == 1 and len(r["groups"]) == 1
    g = r["groups"][0]
    assert g["key"] == "WCOA" and g["label"].startswith("WCOA") and len(g["ids"]) == 14
    assert sorted(r["shown"] + g["ids"]) == sorted(i["id"] for i in items)          # nothing lost


def test_korean_and_spelled_out_names_count_as_the_same_event():
    r = fold([item(1, "세계회계사대회 개막"), item(2, "World Congress of Accountants opens"), item(3, "WCOA day one"), item(4, "Seoul WCOA keynote"), item(5, "WCOA ends"), item(6, "Other")])
    assert len(r["groups"]) == 1 and len(r["groups"][0]["ids"]) == 4 and 6 in r["shown"]


def test_two_articles_about_a_known_event_are_left_alone():
    r = fold(wcoa(2))
    assert r["groups"] == [] and len(r["shown"]) == 2


def test_three_articles_about_a_known_event_fold_to_one():
    r = fold(wcoa(3))
    assert len(r["shown"]) == 1 and len(r["groups"][0]["ids"]) == 2


def test_the_wcoa_headlines_seen_at_kicpa_are_one_event():
    r = fold([item(1, "‘Olympics of Accountants’ World Accountants Conference successfully concluded... First held in Korea"),
              item(2, "‘Olympics of accountants’ WCOA 2026 successfully completed... Opened for the first time in Seoul"),
              item(3, "‘Olympics of accountants’ WCOA 2026 successfully completed... held in Korea for the first time in 122-year history"),
              item(4, "Audit reform bill passes")])
    assert len(r["groups"]) == 1 and len(r["groups"][0]["ids"]) == 2 and 4 in r["shown"]


def test_a_guessed_event_still_needs_five_articles_and_keeps_three():
    four = [item(i, f"ZEBRAX summit news {i}") for i in range(4)]
    assert fold(four)["groups"] == []
    r = fold([item(i, f"ZEBRAX summit news {i}") for i in range(5)])
    assert len(r["shown"]) == 3 and len(r["groups"][0]["ids"]) == 2


def test_what_staff_marked_high_or_medium_or_noted_is_never_folded():
    items = wcoa(15)
    items[10]["relevance"] = "high"
    items[11]["relevance"] = "medium"
    items[12]["notes"] = "Ask the secretariat"
    r = fold(items)
    assert {10, 11, 12} <= set(r["shown"]) and not ({10, 11, 12} & set(r["groups"][0]["ids"]))


def test_the_best_rated_stay_visible_and_order_is_kept():
    items = wcoa(8)
    items[6]["ai_relevance"], items[7]["ai_relevance"], items[1]["ai_relevance"] = "high", "high", "medium"
    r = fold(items)
    assert r["shown"] == [7]                                         # the best rated (newest of the two High) stays; the rest fold
    # a guessed event keeps its three best, in the order given
    g = [item(i, f"ZEBRAX summit news {i}") for i in range(8)]
    g[6]["ai_relevance"], g[7]["ai_relevance"], g[1]["ai_relevance"] = "high", "high", "medium"
    assert fold(g)["shown"] == [1, 6, 7]


def test_an_organisations_own_name_is_not_an_event():
    items = [item(i, f"KICPA announces programme {i}") for i in range(9)]
    assert fold(items)["groups"] == []
    assert fold([item(i, f"IFAC publishes guide {i}") for i in range(9)])["groups"] == []           # another organisation's name


def test_common_accounting_acronyms_are_not_events():
    for word in ("IFRS", "ESG", "ASEAN", "IASB"):
        assert fold([item(i, f"{word} update number {i}") for i in range(9)])["groups"] == []


def test_a_new_event_name_is_found_without_being_listed():
    r = fold([item(i, f"MOSAIC programme news {i}") for i in range(7)])
    assert len(r["groups"]) == 1 and r["groups"][0]["key"] == "MOSAIC" and len(r["shown"]) == 3


def test_shouting_headlines_do_not_make_events():
    assert fold([item(i, f"EXAM RESULTS ANNOUNCED TODAY {i} FOR ALL MEMBERS") for i in range(9)])["groups"] == []


def test_leadership_and_contact_notices_are_never_folded():
    items = [item(i, f"WCOA notice {i}", kind="leadership" if i % 2 else "news") for i in range(14)]
    r = fold(items)
    assert {i for i in range(14) if i % 2} <= set(r["shown"])


def test_two_events_fold_separately():
    items = wcoa(8) + [item(100 + i, f"MOSAIC phase news {i}") for i in range(6)]
    r = fold(items)
    assert sorted(g["key"] for g in r["groups"]) == ["MOSAIC", "WCOA"]
