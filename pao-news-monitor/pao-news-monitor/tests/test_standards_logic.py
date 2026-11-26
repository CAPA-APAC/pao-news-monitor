"""The Standards tab's rules (web/standards-logic.js): calendar layout and the progress line.
Runs the real JavaScript with Node; skipped where Node isn't installed."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

JS = Path(__file__).resolve().parent.parent / "web" / "standards-logic.js"
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="Node.js not installed")


def run_js(body, **data):
    script = f"const L = require({json.dumps(str(JS))}); const D = {json.dumps(data)}; {body}"
    out = subprocess.run(["node", "-e", script], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def ev(i, type, start, end=None, project="p1"):
    return {"id": i, "project_id": project, "type": type, "start_date": start, "end_date": end}


def test_month_grid_starts_on_monday_and_covers_the_month():
    weeks = run_js("console.log(JSON.stringify(L.monthWeeks(2026, 10)))")          # November 2026 starts on a Sunday
    assert weeks[0][0] == "2026-10-26" and weeks[0][6] == "2026-11-01"
    assert weeks[-1][0] == "2026-11-30" and len(weeks) == 6
    assert all(len(w) == 7 for w in weeks)
    feb = run_js("console.log(JSON.stringify(L.monthWeeks(2027, 1)))")             # Feb 2027 starts on a Monday and has 28 days
    assert len(feb) == 4 and feb[0][0] == "2027-02-01" and feb[-1][6] == "2027-02-28"


def test_a_period_is_a_bar_that_continues_across_weeks_and_a_meeting_is_a_block():
    events = [ev(1, "exposure_draft", "2026-11-04", "2026-12-02"), ev(2, "meeting", "2026-11-05")]
    wk = run_js("const w = L.monthWeeks(2026, 10); console.log(JSON.stringify([L.layoutWeek(w[1], D.e), L.layoutWeek(w[3], D.e), L.layoutWeek(w[5], D.e)]))", e=events)
    first, middle, last = wk
    assert first["bars"][0]["col"] == 2 and first["bars"][0]["span"] == 5 and not first["bars"][0]["fromPrev"] and first["bars"][0]["toNext"]
    assert [p["id"] for p in first["points"][3]] == [2]                              # Thursday 5 Nov
    assert middle["bars"][0]["col"] == 0 and middle["bars"][0]["span"] == 7 and middle["bars"][0]["fromPrev"] and middle["bars"][0]["toNext"]
    assert last["bars"][0]["span"] == 3 and last["bars"][0]["fromPrev"] and not last["bars"][0]["toNext"]   # Mon 30 Nov - Wed 2 Dec


def test_overlapping_bars_get_their_own_lanes_and_free_lanes_are_reused():
    events = [ev(1, "exposure_draft", "2026-11-02", "2026-11-10"), ev(2, "call_for_comments", "2026-11-04", "2026-11-06", "p2"),
              ev(3, "call_for_comments", "2026-11-08", "2026-11-09", "p3")]
    wk = run_js("console.log(JSON.stringify(L.layoutWeek(L.monthWeeks(2026, 10)[1], D.e)))", e=events)
    lanes = {b["ev"]["id"]: b["lane"] for b in wk["bars"]}
    assert lanes[1] == 0 and lanes[2] == 1 and wk["lanes"] == 2
    assert lanes[3] == 1                                                                 # fits after #2 ends; no third lane


def test_filters_by_pao_standard_and_type():
    projects = [{"id": "p1", "pao_id": "iaasb"}, {"id": "p2", "pao_id": "ipsasb"}]
    events = [ev(1, "meeting", "2026-11-05"), ev(2, "implementation", "2026-12-15", project="p2"), ev(3, "meeting", "2026-11-09", project="p2"), ev(4, "meeting", "2026-11-01", project="gone")]
    ids = lambda f: run_js("console.log(JSON.stringify(L.visible(D.e, D.p, " + f + ").map(x => x.id)))", e=events, p=projects)  # noqa: E731
    assert ids("{}") == [1, 2, 3]                                                        # a date with no standard is never shown
    assert ids("{paos: new Set(['ipsasb'])}") == [2, 3]
    assert ids("{project: 'p1'}") == [1]
    assert ids("{types: new Set(['meeting'])}") == [1, 3]


def test_a_new_standard_shows_the_four_basic_stages():
    line = run_js("console.log(JSON.stringify(L.stageLine([], '2026-11-26')))")
    assert [n["label"] for n in line] == ["Planning / work plan", "Exposure draft & call for comments", "Post-comments / meetings", "Implementation"]
    assert all(n["kind"] == "placeholder" and n["state"] == "empty" for n in line)


def test_extra_meetings_and_calls_for_comments_add_stages_in_date_order():
    events = [ev(1, "work_plan", "2026-01-15"), ev(2, "exposure_draft", "2026-03-01", "2026-06-30"), ev(3, "meeting", "2026-02-10"),
              ev(4, "meeting", "2026-07-20"), ev(5, "call_for_comments", "2026-09-01", "2026-10-15"), ev(6, "meeting", "2026-11-18"),
              ev(7, "implementation", "2027-12-15")]
    line = run_js("console.log(JSON.stringify(L.stageLine(D.e, '2026-11-26')))", e=events)
    assert [n["ev"]["id"] if n["kind"] == "event" else n["label"] for n in line] == [1, 3, 2, 4, 5, 6, "Post-comments / meetings", 7]
    assert [n["state"] for n in line] == ["done", "done", "done", "done", "done", "done", "empty", "upcoming"]
    assert line[-1]["next"] is True                                                      # the first step still to come


def test_a_plain_meeting_does_not_stand_in_for_the_stage_after_comments():
    line = run_js("console.log(JSON.stringify(L.stageLine(D.e, '2026-11-26')))", e=[ev(1, "meeting", "2026-12-03")])
    assert "Post-comments / meetings" in [n["label"] for n in line if n["kind"] == "placeholder"]


def test_a_stage_skipped_over_is_marked_missed_and_a_period_in_progress_is_current():
    events = [ev(1, "exposure_draft", "2026-11-01", "2026-12-31")]
    line = run_js("console.log(JSON.stringify(L.stageLine(D.e, '2026-11-26')))", e=events)
    assert [(n["label"], n["state"]) for n in line][:2] == [("Planning / work plan", "missed"), ("Exposure draft & call for comments", "current")]
    assert not any(n["next"] for n in line)                                              # something is already under way


def test_summary_says_where_a_standard_is():
    s = lambda e, today="2026-11-26": run_js("console.log(JSON.stringify(L.summary(D.e, '" + today + "')))", e=e)  # noqa: E731
    assert s([]) == {"text": "No dates yet", "tone": "quiet"}
    assert s([ev(1, "exposure_draft", "2026-11-01", "2026-12-01")]) == {"text": "Exposure draft & call for comments: open until 1 Dec 2026 (in 5 days)", "tone": "open"}
    assert s([ev(1, "meeting", "2026-12-03")]) == {"text": "Next: meeting, 3 Dec 2026 (in 7 days)", "tone": "soon"}
    assert s([ev(1, "implementation", "2026-01-01")])["tone"] == "done"
    assert s([ev(1, "issued", "2026-05-01")]) == {"text": "Issued 1 May 2026; no later dates yet", "tone": "quiet"}


def test_upcoming_puts_open_periods_first_then_what_starts_next():
    events = [ev(1, "meeting", "2026-11-01"), ev(2, "exposure_draft", "2026-11-10", "2026-12-10"), ev(3, "meeting", "2026-11-30"), ev(4, "exposure_draft", "2026-10-01", "2026-11-30")]
    ids = run_js("console.log(JSON.stringify(L.upcoming(D.e, '2026-11-26').map(x => x.id)))", e=events)
    assert ids == [4, 2, 3]       # open periods first (soonest to close), then the next dates; the meeting on the 1st is over


def test_dates_are_never_shifted_by_time_zones():
    assert run_js("console.log(JSON.stringify([L.addDays('2026-03-29', 1), L.addDays('2026-12-31', 1), L.diffDays('2026-11-01', '2026-12-01'), L.fmtRange('2026-11-03', '2026-12-12'), L.fmtRange('2026-12-20', '2027-01-15')]))") == [
        "2026-03-30", "2027-01-01", 30, "3 Nov – 12 Dec 2026", "20 Dec 2026 – 15 Jan 2027"]
