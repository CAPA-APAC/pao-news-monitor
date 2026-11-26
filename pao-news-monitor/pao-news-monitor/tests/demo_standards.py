"""Sample standards for the Standards tab in demo mode (web/demo-data.json: std_projects, std_events).
Dates are written as days before / after an anchor day; the page moves them so the demo always looks current."""
from datetime import date, timedelta

ANCHOR = date(2026, 11, 26)

# (project id, setter, title, [(type, start offset, end offset or None, label, source), ...])
PROJECTS = [
    ("iaasb-going-concern", "iaasb", "SAMPLE - Going concern (revised standard)", [
        ("work_plan", -240, None, "Added to the work plan", "manual"),
        ("exposure_draft", -200, -110, "First exposure draft", "manual"),
        ("meeting", -90, None, "Board meeting: comments reviewed", "manual"),
        ("call_for_comments", -20, 25, "Second consultation", "manual"),
        ("meeting", 7, None, "Board meeting", "email"),
        ("feedback_meeting", 60, None, "Approval vote", "manual"),
        ("issued", 120, None, None, "manual"),
        ("implementation", 420, None, "Effective for periods beginning on or after", "manual"),
    ]),
    ("iesba-technology", "iesba", "SAMPLE - Technology-related revisions to the Code", [
        ("work_plan", -180, None, None, "manual"),
        ("exposure_draft", -10, 50, None, "email"),
        ("meeting", 20, None, "Board meeting", "email"),
    ]),
    ("iasb-primary-statements", "iasb", "SAMPLE - Primary financial statements", [
        ("work_plan", -500, None, None, "manual"),
        ("exposure_draft", -380, -200, None, "manual"),
        ("feedback_meeting", -120, None, "Redeliberations", "manual"),
        ("issued", -30, None, None, "manual"),
        ("implementation", 400, None, None, "manual"),
    ]),
    ("issb-climate-amendments", "issb", "SAMPLE - Climate-related disclosures: targeted amendments", [
        ("work_plan", -60, None, None, "manual"),
        ("meeting", -3, None, "Board meeting", "manual"),
        ("exposure_draft", 10, 80, None, "email"),
    ]),
    ("ipsasb-natural-resources", "ipsasb", "SAMPLE - Natural resources", [
        ("exposure_draft", -5, 55, None, "manual"),
        ("meeting", 12, None, "Board meeting", "manual"),
        ("meeting", 40, None, "Board meeting", "manual"),
        ("feedback_meeting", 95, None, None, "manual"),
        ("implementation", 500, None, None, "manual"),
    ]),
    ("ipsasb-sustainability", "ipsasb", "SAMPLE - Sustainability reporting for the public sector", [
        ("work_plan", -20, None, None, "manual"),
    ]),
]


def sample_standards():
    projects, events, n = [], [], 0
    for pid, pao, title, evs in PROJECTS:
        projects.append({"id": pid, "pao_id": pao, "title": title, "description": None, "url": None, "status": "active",
                         "source": "email" if pid == "iesba-technology" else "manual", "created_by": "demo@example.org"})
        for typ, a, b, label, source in evs:
            n += 1
            events.append({"id": n, "project_id": pid, "type": typ, "title": label, "start_date": (ANCHOR + timedelta(days=a)).isoformat(),
                           "end_date": (ANCHOR + timedelta(days=b)).isoformat() if b is not None else None, "url": None, "notes": None,
                           "source": source, "source_item_id": None, "created_by": "demo@example.org"})
    return {"std_anchor": ANCHOR.isoformat(), "std_projects": projects, "std_events": events}
