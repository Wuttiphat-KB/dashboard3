"""
Generate the FlexxFast Monitoring Platform — Integration Specification & Manual.
This is the technical hand-off document sent to CHARGER MANUFACTURERS so they
know what MQTT topics / JSON payloads / timing their firmware must produce for
the charger to plug into the FlexxFast platform.

Output: docs/FlexxFast_Integration_Specification.docx
"""
from pathlib import Path
from docx import Document
from docx.shared import Pt, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

OUT = Path(__file__).resolve().parent.parent / "docs" / "FlexxFast_Integration_Specification.docx"
OUT.parent.mkdir(parents=True, exist_ok=True)

doc = Document()

# ── Default style: cross-lingual font ─────────────────────────────────────
style = doc.styles["Normal"]
style.font.name = "Sarabun"
style.font.size = Pt(10.5)
rpr = style.element.rPr
rfonts = rpr.find(qn("w:rFonts"))
if rfonts is None:
    rfonts = OxmlElement("w:rFonts")
    rpr.append(rfonts)
for tag in ("w:eastAsia", "w:cs", "w:hAnsi", "w:ascii"):
    rfonts.set(qn(tag), "Sarabun")

for section in doc.sections:
    section.top_margin    = Cm(2.0)
    section.bottom_margin = Cm(2.0)
    section.left_margin   = Cm(2.2)
    section.right_margin  = Cm(2.2)

# Brand colours
BRAND_GREEN  = RGBColor(0x2E, 0x9C, 0x3F)
BRAND_ORANGE = RGBColor(0xF2, 0x8A, 0x1F)
DARK         = RGBColor(0x1F, 0x2A, 0x37)
MUTED        = RGBColor(0x60, 0x6E, 0x80)
CODE_BG_HEX  = "F5F5F5"
HEADER_BG    = "2E9C3F"

# ── Helpers ──────────────────────────────────────────────────────────────

def set_cell_bg(cell, hex_color):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tc_pr.append(shd)

def add_h1(text, num=None):
    doc.add_paragraph()
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after  = Pt(6)
    label = f"{num}. {text}" if num else text
    r = p.add_run(label)
    r.font.size = Pt(17)
    r.font.bold = True
    r.font.color.rgb = BRAND_GREEN

def add_h2(text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after  = Pt(3)
    r = p.add_run(text)
    r.font.size = Pt(13)
    r.font.bold = True
    r.font.color.rgb = BRAND_ORANGE

def add_h3(text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after  = Pt(2)
    r = p.add_run(text)
    r.font.size = Pt(11.5)
    r.font.bold = True
    r.font.color.rgb = DARK

def add_para(text, size=10.5, color=None, italic=False, space_after=6, bold=False):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    r = p.add_run(text)
    r.font.size = Pt(size)
    r.italic = italic
    r.font.bold = bold
    if color:
        r.font.color.rgb = color

def add_bullets(items, size=10.5):
    for it in items:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.space_after = Pt(2)
        if isinstance(it, tuple):
            head, body = it
            r = p.add_run(head)
            r.bold = True
            r.font.size = Pt(size)
            r2 = p.add_run("  —  " + body)
            r2.font.size = Pt(size)
        else:
            r = p.add_run(it)
            r.font.size = Pt(size)

def add_code_block(code_str, size=9):
    """Fixed-width monospace block for JSON / examples."""
    tbl = doc.add_table(rows=1, cols=1)
    tbl.autofit = True
    cell = tbl.rows[0].cells[0]
    set_cell_bg(cell, CODE_BG_HEX)
    lines = code_str.rstrip("\n").split("\n")
    for i, line in enumerate(lines):
        p = cell.paragraphs[0] if i == 0 else cell.add_paragraph()
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.space_before = Pt(0)
        r = p.add_run(line or " ")
        r.font.name = "Consolas"
        rpr = r._r.get_or_add_rPr()
        rfonts = OxmlElement("w:rFonts")
        for tag in ("w:eastAsia", "w:cs", "w:hAnsi", "w:ascii"):
            rfonts.set(qn(tag), "Consolas")
        rpr.append(rfonts)
        r.font.size = Pt(size)
        r.font.color.rgb = DARK
    doc.add_paragraph()

def add_field_table(rows, headers=("Field", "Type", "Unit", "Required", "Description")):
    tbl = doc.add_table(rows=1 + len(rows), cols=len(headers))
    tbl.autofit = True
    # header row
    for i, h in enumerate(headers):
        c = tbl.rows[0].cells[i]
        set_cell_bg(c, HEADER_BG)
        p = c.paragraphs[0]
        r = p.add_run(h)
        r.font.bold = True
        r.font.size = Pt(10)
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    # data rows
    for ri, row in enumerate(rows, start=1):
        for ci, val in enumerate(row):
            c = tbl.rows[ri].cells[ci]
            p = c.paragraphs[0]
            r = p.add_run(str(val))
            r.font.size = Pt(9.5)
            if ci == 0:
                r.font.name = "Consolas"
                rp = r._r.get_or_add_rPr()
                rf = OxmlElement("w:rFonts")
                for tag in ("w:eastAsia", "w:cs", "w:hAnsi", "w:ascii"):
                    rf.set(qn(tag), "Consolas")
                rp.append(rf)
                r.font.bold = True
    doc.add_paragraph()

def add_topic_header(topic, description):
    tbl = doc.add_table(rows=1, cols=1)
    cell = tbl.rows[0].cells[0]
    set_cell_bg(cell, "FEF3E6")
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run("TOPIC:  ")
    r.font.size = Pt(10); r.font.bold = True; r.font.color.rgb = BRAND_ORANGE
    r = p.add_run(topic)
    r.font.name = "Consolas"
    rp = r._r.get_or_add_rPr()
    rf = OxmlElement("w:rFonts")
    for tag in ("w:eastAsia", "w:cs", "w:hAnsi", "w:ascii"):
        rf.set(qn(tag), "Consolas")
    rp.append(rf)
    r.font.size = Pt(11); r.font.bold = True; r.font.color.rgb = DARK
    p2 = cell.add_paragraph()
    p2.paragraph_format.space_after = Pt(0)
    r = p2.add_run(description)
    r.font.size = Pt(10); r.font.color.rgb = MUTED

def page_break():
    doc.add_page_break()

# ═════════════════════════════════════════════════════════════════════════
# COVER PAGE
# ═════════════════════════════════════════════════════════════════════════

for _ in range(4):
    doc.add_paragraph()

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("FlexxFast")
r.font.size = Pt(48); r.font.bold = True; r.font.color.rgb = BRAND_GREEN

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("Monitoring Platform")
r.font.size = Pt(20); r.font.color.rgb = BRAND_ORANGE; r.font.bold = True

doc.add_paragraph()
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("Specification & Integration Manual")
r.font.size = Pt(22); r.font.bold = True; r.font.color.rgb = DARK

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("For Charger Manufacturers")
r.font.size = Pt(13); r.font.italic = True; r.font.color.rgb = MUTED

for _ in range(6):
    doc.add_paragraph()

# Info card
tbl = doc.add_table(rows=4, cols=2)
tbl.alignment = WD_ALIGN_PARAGRAPH.CENTER
for i, (k, v) in enumerate([
    ("Document title", "FlexxFast Integration Specification"),
    ("Document version", "1.0"),
    ("Status", "Submitted"),
    ("Prepared by", "EDS Engineering Solutions"),
]):
    c0 = tbl.rows[i].cells[0]
    c1 = tbl.rows[i].cells[1]
    set_cell_bg(c0, "F5F8FA")
    p = c0.paragraphs[0]
    r = p.add_run(k)
    r.font.bold = True; r.font.size = Pt(10); r.font.color.rgb = MUTED
    p = c1.paragraphs[0]
    r = p.add_run(v)
    r.font.size = Pt(10.5); r.font.color.rgb = DARK
    tbl.rows[i].cells[0].width = Cm(5.0)
    tbl.rows[i].cells[1].width = Cm(9.0)

for _ in range(6):
    doc.add_paragraph()

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("Submitted to: __________________________________________")
r.font.size = Pt(11); r.font.color.rgb = DARK

page_break()

# ═════════════════════════════════════════════════════════════════════════
# TABLE OF CONTENTS (manual — no auto TOC)
# ═════════════════════════════════════════════════════════════════════════

add_h1("Table of Contents")
toc = [
    "1.  Executive Summary",
    "2.  System Architecture",
    "3.  Prerequisites & Network Requirements",
    "4.  Integration Path Selection (Phoenix vs Vector)",
    "5.  Common MQTT Requirements",
    "6.  Path A — Phoenix Controller Specification",
    "7.  Path B — Vector Controller Specification",
    "8.  Timing, QoS & Reliability Requirements",
    "9.  Field Reference — Units & Ranges",
    "10. Station Identifier & Naming",
    "11. Integration Test Checklist",
    "12. Deliverables Checklist",
    "13. Change Log & Version Control",
    "14. Support & Contact",
    "Appendix A. Full Payload Examples",
]
for line in toc:
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(line)
    r.font.size = Pt(11)

page_break()

# ═════════════════════════════════════════════════════════════════════════
# 1. EXECUTIVE SUMMARY
# ═════════════════════════════════════════════════════════════════════════

add_h1("Executive Summary", num=1)
add_para(
    "This document specifies the technical requirements for integrating a DC fast "
    "charger with the FlexxFast Monitoring Platform. It is intended for charger "
    "manufacturers who will implement (or verify) the MQTT publishing logic in "
    "their controller firmware."
)
add_para(
    "The FlexxFast platform ingests real-time telemetry from every deployed "
    "charger via MQTT, stores time-series data in MongoDB, and presents it on a "
    "web dashboard used by operators, technicians, and business owners."
)
add_para(
    "Two integration paths are supported:", bold=True, space_after=2,
)
add_bullets([
    ("Path A — Phoenix style (legacy)",
     "Multiple MQTT topics, one per data domain (heartbeat, meter, powerModule, plc, fanRPM, etc.)."),
    ("Path B — Vector style (recommended for new designs)",
     "A single consolidated state topic that carries PLC, PowerModule, isolation, cable temps, contactor, and emergency in one JSON payload."),
])
add_para(
    "The manufacturer must implement one path in full. Sections 6 and 7 provide "
    "the exact schemas, field types, and cadence requirements.", space_after=0,
)

# ═════════════════════════════════════════════════════════════════════════
# 2. SYSTEM ARCHITECTURE
# ═════════════════════════════════════════════════════════════════════════

add_h1("System Architecture", num=2)
add_para(
    "FlexxFast is a 3-layer system. The charger participates only in the Edge Layer:"
)

architecture = """\
┌───────────────────────────────────────────────────────────────────┐
│                          FRONTEND (Web)                           │
│              Next.js dashboard — real-time updates                │
└───────────────▲───────────────────────────────────────────────────┘
                │  WebSocket + REST
                │
┌───────────────┴───────────────────────────────────────────────────┐
│                       BACKEND (Node.js)                           │
│    MQTT subscriber  →  parser  →  MongoDB writes  →  WS push      │
└───────────────▲──────────────────────────▲────────────────────────┘
                │                          │
                │   MQTT                   │  MongoDB
                │                          │
┌───────────────┴──────────────┐   ┌───────┴───────────────────────┐
│        MQTT BROKER           │   │        MONGODB CLUSTER        │
│   (provided by EDS)          │   │   time-series + config store  │
└───────────────▲──────────────┘   └───────────────────────────────┘
                │
                │  publish
                │
┌───────────────┴──────────────────────────────────────────────────┐
│                         CHARGER (Edge)                           │
│    Controller  →  MQTT client  →  publish topics per this spec   │
│           ═══════════════ THIS IS YOU ═══════════════            │
└──────────────────────────────────────────────────────────────────┘
"""
add_code_block(architecture, size=8)

add_para(
    "The charger's ONLY responsibility is to publish the topics defined in this "
    "document to the MQTT broker whose credentials EDS will provide. All parsing, "
    "storage, alerting, and presentation is handled downstream by FlexxFast."
)

# ═════════════════════════════════════════════════════════════════════════
# 3. PREREQUISITES
# ═════════════════════════════════════════════════════════════════════════

add_h1("Prerequisites & Network Requirements", num=3)

add_h2("3.1 What EDS Will Provide")
add_bullets([
    ("MQTT Broker URL", "e.g. mqtt://broker.example.com:1883 (or mqtts:// for TLS)."),
    ("MQTT Credentials", "Username and password per charger, or a shared credential — configurable."),
    ("Assigned Station ID", "A unique short identifier, e.g. BKN1, BKK-001. Used in topic names and MongoDB collection names."),
    ("Confirmation of MongoDB collection names", "Optional — needed only if the manufacturer will pre-provision Mongo collections. Normally not required."),
])

add_h2("3.2 What the Manufacturer Must Provide")
add_bullets([
    "Reliable outbound Internet connection from the charger (typically 4G/5G router).",
    "MQTT client library integrated into the controller firmware.",
    "Accurate real-time clock (NTP-synced). ISO 8601 timestamps are used throughout.",
    "Ability to publish JSON payloads on configurable MQTT topics.",
    "Handling of MQTT reconnection with exponential back-off (in case of network drop).",
    "Ability to buffer OR drop messages during offline periods (backpressure) — see §8.",
])

add_h2("3.3 Network Ports")
add_field_table(
    rows=[
        ("1883",  "TCP", "Outbound", "Yes", "MQTT (plain-text)"),
        ("8883",  "TCP", "Outbound", "Optional", "MQTT over TLS (recommended for public networks)"),
        ("443",   "TCP", "Outbound", "Yes",  "HTTPS — used by OCPP / OTA firmware download"),
        ("123",   "UDP", "Outbound", "Yes",  "NTP time sync"),
    ],
    headers=("Port", "Proto", "Direction", "Required", "Purpose"),
)

# ═════════════════════════════════════════════════════════════════════════
# 4. INTEGRATION PATH SELECTION
# ═════════════════════════════════════════════════════════════════════════

add_h1("Integration Path Selection", num=4)
add_para(
    "Choose ONE path based on your controller platform. Do not mix — the backend "
    "expects a single, consistent pattern per station."
)

add_h2("4.1 Path A — Phoenix Controller (multi-topic)")
add_bullets([
    "Use if your firmware already exposes distinct services (PLC, PowerModule, meter, fan, script heartbeats) as separate MQTT topics.",
    "Requires 6-9 topics per station, each with its own JSON payload.",
    "Simpler to add/remove individual data streams.",
    "Backward compatible with legacy EDS installations.",
])

add_h2("4.2 Path B — Vector Controller (single state topic) — Recommended for new designs")
add_bullets([
    "Use if you're building a new firmware or refactoring an existing one.",
    "One MQTT topic carries a consolidated JSON snapshot of the entire charger state.",
    "Simpler broker load (~1 topic instead of ~8 per station).",
    "Add-on script on the charger's Linux side (recommended) computes derived fields (power_kw, stale_s, faulty temp filter).",
])

add_h2("4.3 Decision Matrix")
add_field_table(
    rows=[
        ("Existing firmware with multi-service MQTT", "Path A (Phoenix)", "No firmware rewrite; keep as-is."),
        ("New charger design",                        "Path B (Vector)",  "Cleaner integration; fewer topics."),
        ("Retrofit of older charger",                 "Path A (Phoenix)", "Easier to bolt on missing topics one by one."),
        ("Constrained MQTT broker license (topic count)", "Path B (Vector)", "One topic per station reduces broker cost."),
    ],
    headers=("Scenario", "Recommendation", "Reason"),
)

# ═════════════════════════════════════════════════════════════════════════
# 5. COMMON MQTT REQUIREMENTS
# ═════════════════════════════════════════════════════════════════════════

add_h1("Common MQTT Requirements", num=5)
add_para("Regardless of the path chosen, the following requirements apply to every station.")

add_h2("5.1 Topic Naming Convention")
add_para(
    "Manufacturers may propose their own topic names, BUT they must be:", space_after=2,
)
add_bullets([
    "Unique per station (embed the assigned Station ID).",
    "Stable — do NOT change topic names after deployment without prior notice to EDS.",
    "ASCII only — no Unicode characters.",
    "Case-sensitive — use consistent capitalization.",
])
add_para(
    "Recommended pattern (both paths):", space_after=2,
)
add_code_block("""\
OCPP/<STATION_ID>/<subsystem>

Examples:
  OCPP/BKN1/heartbeat
  OCPP/BKN1/meter
  OCPP/BKN1/pm/data
  OCPP/BKN1/plc/data
  OCPP/BKN1/state       (Vector path — the consolidated topic)
""")

add_h2("5.2 Payload Format")
add_bullets([
    "MUST be valid UTF-8 JSON.",
    "Number fields MUST be JSON numbers (not strings) unless otherwise noted.",
    "Timestamps MUST be ISO 8601 strings — accepted formats are  YYYY-MM-DDTHH:MM:SS.ffffff  (local, no timezone) OR  YYYY-MM-DDTHH:MM:SS.fffZ  (UTC).",
    "Null / missing fields are tolerated when noted in the schema. Send null rather than 0 for 'not measured'.",
])

add_h2("5.3 Common Topics (both paths need these)")
add_para(
    "The following topics are required regardless of controller type. They cover "
    "device-level heartbeat and network health, and are handled by the same "
    "backend pipeline for both paths.", space_after=2,
)

# Heartbeat
add_h3("5.3.1  Heartbeat")
add_topic_header("OCPP/<STATION_ID>/heartbeat", "Alive signal from the OCPP box / main controller.")
add_para("Publish every 30 seconds. Payload:")
add_code_block("""\
{
  "heartbeat": 1,
  "timestamp": "2026-06-11T14:23:45.123456"
}""")
add_field_table(
    rows=[
        ("heartbeat", "integer",  "—",   "Yes", "Always 1 when device is alive."),
        ("timestamp", "ISO 8601", "—",   "Yes", "Time of message generation."),
    ],
)

# Heartbeat Pi5 (optional)
add_h3("5.3.2  Heartbeat — Pi5 (optional)")
add_topic_header("OCPP/<STATION_ID>/heartbeatPI5", "Alive signal from the onboard Raspberry Pi 5. Omit if station has no Pi5.")
add_code_block("""\
{
  "heartbeatPI5": 1,
  "timestamp": "2026-06-11T14:23:45.123456"
}""")

# Router
add_h3("5.3.3  Router status")
add_topic_header("<STATION_ID>  OR  OCPP/<STATION_ID>/router", "4G/5G router health. Publish every 30 seconds.")
add_code_block("""\
{
  "Status": {
    "connstate": "Connected",
    "temp":      520,
    "rssi":      -68,
    "rsrp":      -95,
    "rsrq":      -12,
    "sinr":      15,
    "conntype":  "LTE",
    "operator":  "AIS",
    "model":     "RG5000",
    "manuf":     "ExampleCo",
    "imei":      "864000000000000",
    "iccid":     "89660000000000000000",
    "ip":        ["10.0.0.10"]
  }
}""")
add_para(
    "Note: temp is the raw sensor value — divide by 10 to get °C. So 520 = 52.0°C.",
    italic=True, color=MUTED,
)
add_field_table(
    rows=[
        ("connstate", "string",  "—",     "Yes", "\"Connected\" or \"Disconnected\"."),
        ("temp",      "integer", "1/10°C", "Yes", "Router internal temperature × 10. e.g. 520 = 52.0°C."),
        ("rssi",      "integer", "dBm",   "Yes", "Signal strength (typical -50 to -110)."),
        ("rsrp",      "integer", "dBm",   "Opt", "Reference Signal Received Power."),
        ("rsrq",      "integer", "dB",    "Opt", "Reference Signal Received Quality."),
        ("sinr",      "integer", "—",     "Opt", "Signal-to-interference-plus-noise ratio."),
        ("conntype",  "string",  "—",     "Opt", "e.g. \"LTE\", \"5G-NR\"."),
        ("operator",  "string",  "—",     "Opt", "Carrier name."),
        ("model / manuf / imei / iccid", "string", "—", "Opt", "Router identity for inventory."),
        ("ip",        "array of strings", "—", "Opt", "Assigned IP addresses."),
    ],
)

# Meter
add_h3("5.3.4  Meter")
add_topic_header("OCPP/<STATION_ID>/meter", "kWh accumulator per charging head. Publish every 30-60 seconds.")
add_code_block("""\
{
  "meter1":     131734760,
  "meter2":     119364060,
  "timestamp1": "2026-06-11T14:23:44.501234",
  "timestamp2": "2026-06-11T14:23:44.501289",
  "timestamp":  "2026-06-11T14:23:44.501300"
}""")
add_field_table(
    rows=[
        ("meter1",     "integer",  "Wh",       "Yes",  "Head-1 lifetime energy counter in Watt-hours."),
        ("meter2",     "integer",  "Wh",       "Cond", "Head-2 same. Send 0 if station has only one head."),
        ("timestamp1", "ISO 8601", "—",        "Yes",  "Time meter1 was read."),
        ("timestamp2", "ISO 8601", "—",        "Cond", "Time meter2 was read."),
        ("timestamp",  "ISO 8601", "—",        "Yes",  "Message generation time."),
    ],
)

page_break()

# ═════════════════════════════════════════════════════════════════════════
# 6. PATH A — Phoenix Specification
# ═════════════════════════════════════════════════════════════════════════

add_h1("Path A — Phoenix Controller Specification", num=6)
add_para(
    "In addition to the common topics (§5.3), a Phoenix-style charger must publish "
    "the following topics."
)

# --- Power Module ---
add_h2("6.1  Power Module Data")
add_topic_header("OCPP/<STATION_ID>/PowerModule",
                 "Per-head power module status. Publish separately for each head — the payload contains PM1 XOR PM2, not both.")
add_h3("Head 1 payload")
add_code_block("""\
{
  "PM1":          "2",
  "Voltage1":     418.2,
  "Current1":     28,
  "Power1":       11710,
  "Prevoltage1":  413,
  "Precurrent1":  28,
  "timestamp1":   "2026-06-11T14:23:44.501234",
  "timestamp":    "2026-06-11T14:23:44.501300"
}""")
add_h3("Head 2 payload")
add_code_block("""\
{
  "PM2":          "3",
  "Voltage2":     384.4,
  "Current2":     132,
  "Power2":       50740,
  "Prevoltage2":  365,
  "Precurrent2":  132,
  "timestamp2":   "2026-06-11T14:23:45.101112",
  "timestamp":    "2026-06-11T14:23:45.101189"
}""")
add_field_table(
    rows=[
        ("PM{N}",         "string→int", "count",  "Yes", "Number of online power modules for head N."),
        ("Voltage{N}",    "number",     "V",      "Yes", "DC output voltage."),
        ("Current{N}",    "number",     "A",      "Yes", "DC output current."),
        ("Power{N}",      "number",     "W",      "Yes", "Instantaneous output power. Divide by 1000 for kW."),
        ("Prevoltage{N}", "number",     "V",      "Opt", "Pre-charge voltage."),
        ("Precurrent{N}", "number",     "A",      "Opt", "Pre-charge current."),
        ("timestamp{N}",  "ISO 8601",   "—",      "Yes", "Time this head was sampled."),
        ("timestamp",     "ISO 8601",   "—",      "Yes", "Message generation time."),
    ],
)

# --- PLC ---
add_h2("6.2  PLC / Charging State")
add_topic_header("OCPP/<STATION_ID>/PLC",
                 "Combined per-head charging state, isolation, cable temperatures, and device statuses. Publish every 1-5 seconds during charging; every 5-10 seconds when idle.")
add_code_block("""\
{
  "chargeState1":     "Charging",
  "chargeState2":     "Ready",
  "SOC1":              63,
  "SOC2":              0,
  "powerKw1":          45,
  "powerKw2":          0,
  "presentVoltage1":   410,
  "presentCurrent1":   110,
  "presentVoltage2":   0,
  "presentCurrent2":   0,
  "temp1Head1":        48,
  "temp2Head1":        49,
  "temp1Head2":        0,
  "temp2Head2":        0,
  "tempPowerModule1":  44,
  "tempPowerModule2":  40,
  "insulationFault1":  0,
  "insulationFault2":  0,
  "head1Error":        0,
  "head2Error":        0,
  "errorMessage1":     "",
  "errorMessage2":     "",
  "activeMld1":        2,
  "activeMld2":        0,
  "HMI_status":        "Active",
  "PLC1_status":       "Active",
  "PLC2_status":       "Active",
  "fan_status1_8":     "1",
  "timestamp":         "2026-06-11T14:23:45.101189"
}""")
add_field_table(
    rows=[
        ("chargeState{N}",     "string",  "—", "Yes", "\"Ready\" | \"Connected\" | \"Charging\" | \"Fault\" | \"Unknown\"."),
        ("SOC{N}",             "integer", "%", "Yes", "State of Charge from EV."),
        ("powerKw{N}",         "number",  "kW", "Yes", "Instantaneous head power."),
        ("presentVoltage{N}",  "number",  "V", "Yes", "Actual DC output voltage at the connector."),
        ("presentCurrent{N}",  "number",  "A", "Yes", "Actual DC output current."),
        ("temp1Head{N}",       "number",  "°C", "Yes", "Cable + terminal temperature."),
        ("temp2Head{N}",       "number",  "°C", "Yes", "Cable – terminal temperature."),
        ("tempPowerModule{N}", "number",  "°C", "Opt", "Power module internal temperature."),
        ("insulationFault{N}", "integer", "—", "Yes", "0 = OK, 1 = fault detected."),
        ("head{N}Error",       "integer", "—", "Yes", "0 = no error, 1 = error active on this head."),
        ("errorMessage{N}",    "string",  "—", "Opt", "Human-readable error text."),
        ("activeMld{N}",       "integer", "count", "Opt", "Active MLD count."),
        ("HMI_status",         "string",  "—", "Yes", "\"Active\" | \"Inactive\" | \"N/A\" (DWIN displays send \"N/A\")."),
        ("PLC1_status / PLC2_status", "string", "—", "Yes", "\"Active\" or \"Inactive\"."),
        ("fan_status1_8",      "string",  "bitmask", "Opt", "8-bit fan-status bitmask (\"0\" to \"255\")."),
        ("timestamp",          "ISO 8601", "—", "Yes", "Message generation time."),
    ],
)

# --- Fault Status ---
add_h2("6.3  Fault Status Script Heartbeat")
add_topic_header("OCPP/<STATION_ID>/script/fault_hb",
                 "Alive signal from the fault-monitor script on the edge. Publish every 30 seconds.")
add_code_block("""\
{
  "heartbeat": 1,
  "timestamp": "2026-06-11T14:23:45.101189"
}""")

# --- Fan RPM ---
add_h2("6.4  Fan RPM")
add_topic_header("OCPP/<STATION_ID>/fan/rpm",
                 "Per-fan RPM readings. Send all 8 fans in a single message. Publish every 5-15 seconds.")
add_code_block("""\
{
  "FAN 1": 5397.99,
  "FAN 2": 5432.10,
  "FAN 3": 5410.55,
  "FAN 4": 5388.20,
  "FAN 5": 0,
  "FAN 6": 0,
  "FAN 7": 5450.88,
  "FAN 8": 5503.99
}""")
add_para(
    "Keys MUST be exactly \"FAN 1\" through \"FAN 8\" (space between FAN and digit). "
    "Values are RPM as JSON numbers. A value of 0 means the fan is idle or has stopped.",
    italic=True, color=MUTED,
)

page_break()

# ═════════════════════════════════════════════════════════════════════════
# 7. PATH B — Vector Controller
# ═════════════════════════════════════════════════════════════════════════

add_h1("Path B — Vector Controller Specification", num=7)
add_para(
    "In addition to the common topics (§5.3), a Vector-style charger publishes a "
    "single consolidated state topic."
)

add_h2("7.1  Vector State")
add_topic_header("OCPP/<STATION_ID>/state  (or any name — configurable in FlexxFast)",
                 "One JSON snapshot covering connectors, power_module, isolation, temps, contactor, emergency. Publish every 1-2 seconds while any connector is active; every 5-10 seconds when idle.")
add_code_block("""\
{
  "charger": "BKN1",
  "ts": "2026-06-11T14:23:45.409Z",
  "connectors": {
    "1": {
      "cp_state":       "state_c",
      "session_state":  "CurrentDemand",
      "standard":       "din70121",
      "auth_state":     "authorized",
      "meas_v":         410,
      "meas_i":         110.03,
      "power_kw":       45.10,
      "req_v":          453.2,
      "req_i":          110,
      "soc":            63,
      "ttf_min":        41,
      "energy":         null,
      "em_status":      null,
      "ev_max_v":       495.1,
      "complete":       false,
      "ev_ready":       true,
      "err_code":       "VSECCLIB_DC_EVERROR_CODE_TYPE_NO_ERROR",
      "active_failures": [],
      "pp_state":       "disconnected",
      "stale_s":        0.1
    },
    "2": { "cp_state": "state_a", "meas_v": null, ... }
  },
  "power_module": {
    "status":         "operative",
    "max_power_kw_1": 50,
    "max_power_kw_2": 75,
    "max_current_1":  150,
    "max_current_2":  150,
    "meas_v":         410,
    "meas_i":         110.03,
    "modules": {
      "configured_total": 5,
      "online_total":     5,
      "active_total":     2,
      "per_group": {
        "1": { "configured":2, "online":2, "reporting":2, "active":2, "voltage":410, "current":110 },
        "2": { "configured":3, "online":3, "reporting":3, "active":0, "voltage":0,   "current":0   }
      }
    }
  },
  "isolation": {
    "iso1":       1,
    "iso2":       1,
    "imd_status": "operative"
  },
  "temps": {
    "t1":     43.61,
    "t2":     39.22,
    "t3":     42.73,
    "t4":     38.52,
    "faulty": null
  },
  "emergency":    1,
  "estop_active": false,
  "contactor": {
    "c1": "closed",
    "c2": "open"
  }
}""")

add_h3("Connector fields  (per connector, \"1\" and \"2\")")
add_field_table(
    rows=[
        ("cp_state",       "string",  "—", "Yes", "Control Pilot: state_a (idle) | state_b (connected) | state_c/d (charging) | state_e/f (fault)."),
        ("session_state",  "string",  "—", "Opt", "DIN 70121 stage. Null when idle."),
        ("standard",       "string",  "—", "Opt", "\"din70121\" | \"iso15118\"."),
        ("auth_state",     "string",  "—", "Opt", "\"authorized\" | \"pending\"."),
        ("meas_v",         "number|null", "V", "Yes", "Actual DC output voltage. Null when idle."),
        ("meas_i",         "number|null", "A", "Yes", "Actual DC output current. Null when idle."),
        ("power_kw",       "number|null", "kW", "Yes", "Computed as V×I/1000. Null when idle."),
        ("req_v",          "number|null", "V", "Opt", "BMS-requested voltage."),
        ("req_i",          "number|null", "A", "Opt", "BMS-requested current."),
        ("soc",            "integer|null", "%", "Yes", "State of Charge from EV. Null when no EV."),
        ("ttf_min",        "integer|null", "min", "Opt", "Time-to-full from EV estimate."),
        ("energy",         "integer|null", "Wh", "Opt", "Session cumulative energy. Null until meter reports."),
        ("ev_max_v",       "number|null",  "V", "Opt", "Maximum battery voltage advertised by EV."),
        ("complete",       "boolean|null", "—", "Opt", "True when charging complete."),
        ("ev_ready",       "boolean|null", "—", "Opt", "True when EV signals ready."),
        ("err_code",       "string|null",  "—", "Yes", "Manufacturer error code. Send \"VSECCLIB_DC_EVERROR_CODE_TYPE_NO_ERROR\" or equivalent when no error."),
        ("active_failures","array of strings", "—", "Yes", "List of currently-active fault names. Empty array when none."),
        ("stale_s",        "number", "s", "Opt", "Seconds since this connector was last updated. Add-on script computes this."),
    ],
)

add_h3("power_module fields")
add_field_table(
    rows=[
        ("status",           "string",  "—", "Yes", "\"operative\" | anything-else."),
        ("max_power_kw_{N}", "integer", "kW", "Opt", "Peak power rating per side."),
        ("max_current_{N}",  "integer", "A",  "Opt", "Configured current limit per side."),
        ("modules.per_group.{N}.configured", "integer", "count", "Yes", "Slots configured for this head."),
        ("modules.per_group.{N}.online",     "integer", "count", "Yes", "Modules currently online. Displayed as pmCount on dashboard."),
        ("modules.per_group.{N}.active",     "integer", "count", "Yes", "Modules actively supplying current."),
        ("modules.per_group.{N}.voltage",    "number", "V", "Yes", "Group DC output voltage."),
        ("modules.per_group.{N}.current",    "number", "A", "Yes", "Group DC output current."),
    ],
)

add_h3("isolation")
add_field_table(
    rows=[
        ("iso1 / iso2", "integer", "—", "Yes", "1 = insulation OK, 0 = insulation fault."),
        ("imd_status",  "string",  "—", "Yes", "\"operative\" | \"inactive\" — Insulation Monitor Device health."),
    ],
)

add_h3("temps  (cable-terminal temperatures)")
add_field_table(
    rows=[
        ("t1", "number|null", "°C", "Yes", "Head 1 + terminal."),
        ("t2", "number|null", "°C", "Yes", "Head 1 – terminal."),
        ("t3", "number|null", "°C", "Yes", "Head 2 + terminal."),
        ("t4", "number|null", "°C", "Yes", "Head 2 – terminal."),
        ("faulty", "array of strings | null", "—", "Yes", "Names of temperature sensors that returned invalid readings (e.g. [\"t1\",\"t3\"]). Send null when all sensors report."),
    ],
)

add_h3("emergency / estop / contactor")
add_field_table(
    rows=[
        ("emergency",    "integer", "—", "Yes", "Safety loop: 1 = OK, 0 = tripped."),
        ("estop_active", "boolean", "—", "Yes", "True if the emergency stop button is currently pressed."),
        ("contactor.c1 / c2", "string", "—", "Yes", "\"closed\" | \"open\" — DC contactor per head."),
    ],
)

add_h3("Top-level")
add_field_table(
    rows=[
        ("charger", "string",   "—", "Yes", "Station identifier (must match assigned Station ID or be aliased in config)."),
        ("ts",      "ISO 8601", "—", "Yes", "Snapshot generation time (UTC, with Z). NOTE: FlexxFast will REGENERATE its own timestamp on ingest — see §8.4."),
    ],
)

page_break()

# ═════════════════════════════════════════════════════════════════════════
# 8. TIMING, QoS & RELIABILITY
# ═════════════════════════════════════════════════════════════════════════

add_h1("Timing, QoS & Reliability Requirements", num=8)

add_h2("8.1 Publish Frequency")
add_field_table(
    rows=[
        ("heartbeat",           "≤ 30 s",  "Fixed interval regardless of state."),
        ("heartbeatPI5",        "≤ 30 s",  "Same as heartbeat."),
        ("router",              "≤ 30 s",  "Fixed interval."),
        ("meter",               "30–60 s", "More often OK. Avoid < 5 s."),
        ("PowerModule (Phoenix)", "5–15 s", "Faster when actively charging."),
        ("PLC (Phoenix)",       "1–5 s",   "Faster while charging; 5-10 s idle."),
        ("fault_hb",            "≤ 30 s",  "Script alive signal."),
        ("fan/rpm",             "5–15 s",  "Any change qualifies."),
        ("state (Vector)",      "1–2 s active / 5–10 s idle", "Consolidated snapshot."),
    ],
    headers=("Topic", "Recommended cadence", "Notes"),
)

add_h2("8.2 Timeout Thresholds")
add_para("The FlexxFast backend applies these timeouts:")
add_field_table(
    rows=[
        ("Any heartbeat topic",   "5 minutes",  "Device is marked OFFLINE and an alert is raised."),
        ("Meter unchanged",       "2 days",     "Meter is marked STALLED (LED red)."),
        ("PLC / vector state",    "5 minutes",  "Feeds into OFFLINE detection."),
        ("Script heartbeat",      "5 minutes",  "Script is marked OFFLINE."),
    ],
    headers=("Signal", "Timeout", "Effect"),
)
add_para(
    "Manufacturer must ensure that publishing gaps stay comfortably below these "
    "thresholds under normal network conditions.",
    italic=True, color=MUTED,
)

add_h2("8.3 QoS & Retention")
add_field_table(
    rows=[
        ("Heartbeats",       "0", "No",  "Loss of one message is acceptable — next one resets the timer."),
        ("Meter",            "0 or 1", "No", "Use QoS 1 if broker supports it."),
        ("Power Module / PLC / State", "0 or 1", "No", "QoS 0 is acceptable for high-frequency data."),
        ("Router",           "0 or 1", "Yes", "Retained message helps late-joining subscribers see current status."),
        ("Fan RPM",          "0", "No", "Time-series."),
    ],
    headers=("Message", "QoS", "Retained?", "Notes"),
)

add_h2("8.4 Timestamp Handling")
add_para(
    "IMPORTANT: The FlexxFast backend REGENERATES its own reception timestamp for "
    "every payload that lands in `_plc_data`, `_pm_data`, and `_meter_latest`. "
    "This is a defensive measure against chargers whose real-time clock is "
    "unsynced. Manufacturers should still send accurate timestamps in payloads — "
    "they are stored in the raw history collections for audit."
)
add_para(
    "Regardless of the above, please NTP-sync all chargers.",
    italic=True, color=MUTED,
)

add_h2("8.5 Reconnection Behavior")
add_bullets([
    "Implement exponential back-off on MQTT reconnect (min 5 s, cap 60 s).",
    "On reconnect, publish an immediate heartbeat + retained router status.",
    "Do NOT flood the broker with buffered messages after a long disconnect — drop time-series older than 5 minutes on reconnect. See §8.6 for the recommended local buffer size.",
])

add_h2("8.6 Local Buffering (recommended)")
add_bullets([
    "Buffer up to 200 recent messages while offline.",
    "On reconnect, publish only the last 5 minutes of buffered data (drop older).",
    "For meter readings, ensure the latest cumulative value is always sent on reconnect (even if older messages were dropped).",
])

# ═════════════════════════════════════════════════════════════════════════
# 9. FIELD REFERENCE
# ═════════════════════════════════════════════════════════════════════════

add_h1("Field Reference — Units & Ranges", num=9)

add_h2("9.1 Value Ranges (validation)")
add_field_table(
    rows=[
        ("cable temp (temp1Head, temp2Head, t1..t4)", "0 – 200 °C", "Warning ≥ 150 °C, Danger ≥ 190 °C."),
        ("router temp (Status.temp)",                 "0 – 1200",  "In 1/10 °C. Divide by 10 for °C. Warning ≥ 700 (70°C), Danger ≥ 800 (80°C)."),
        ("SOC",                                       "0 – 100 %", "Send null when no EV connected."),
        ("Voltage (DC output)",                       "0 – 1000 V", "Modern DC fast chargers."),
        ("Current (DC output)",                       "0 – 500 A",  ""),
        ("Power (per head)",                          "0 – 250 kW", ""),
        ("meter{N}",                                  "monotonically increasing", "MUST NOT decrease across messages."),
        ("Fan RPM",                                   "0 – 8000 RPM", "0 = idle/stopped."),
        ("rssi",                                      "-120 to -30 dBm", ""),
    ],
    headers=("Field", "Expected range", "Notes"),
)

add_h2("9.2 Null vs Zero")
add_para(
    "There is a semantic difference between null (\"not measured / no data\") and "
    "0 (\"measured, value is zero\"). Manufacturers should:", space_after=2,
)
add_bullets([
    "Send null when a sensor is disconnected or a measurement is not applicable (e.g. connector idle → soc = null).",
    "Send 0 only when the physical quantity truly IS zero (e.g. an idle fan → rpm = 0).",
    "Never send \"\" (empty string) for numeric fields — use null.",
])

# ═════════════════════════════════════════════════════════════════════════
# 10. STATION IDENTIFIER
# ═════════════════════════════════════════════════════════════════════════

add_h1("Station Identifier & Naming", num=10)
add_para(
    "EDS will assign each charger a unique Station ID (also called the "
    "\"station name\"). This identifier is used in:", space_after=2,
)
add_bullets([
    "MQTT topic paths (e.g. OCPP/<STATION_ID>/heartbeat).",
    "The MongoDB collection name that stores this charger's config.",
    "The charger's row on the FlexxFast dashboard.",
])
add_h3("Naming rules")
add_bullets([
    "ASCII only.",
    "Letters (A-Z, a-z), digits (0-9), underscore (_), and hyphen (-) only.",
    "Max 80 characters.",
    "Case-sensitive — treat \"BKN1\" and \"bkn1\" as different stations.",
    "MUST be unique across the customer's fleet.",
])
add_para(
    "The station's display name (shown to human operators, e.g. \"บางนา สาขา 1\") is "
    "configured separately in the FlexxFast dashboard and is unrelated to this "
    "identifier.",
    italic=True, color=MUTED,
)

page_break()

# ═════════════════════════════════════════════════════════════════════════
# 11. TEST CHECKLIST
# ═════════════════════════════════════════════════════════════════════════

add_h1("Integration Test Checklist", num=11)
add_para(
    "Before requesting FlexxFast onboarding, the manufacturer should verify each "
    "item below. EDS will re-run these checks during acceptance."
)

def checklist(items):
    for it in items:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(3)
        r = p.add_run("☐  ")
        r.font.name = "Consolas"
        r.font.size = Pt(11); r.font.bold = True
        r2 = p.add_run(it)
        r2.font.size = Pt(10.5)

add_h2("11.1  Connectivity")
checklist([
    "Charger connects to the EDS-provided MQTT broker using assigned credentials.",
    "TLS negotiation succeeds (if using mqtts://).",
    "Reconnect works within 60 s after a simulated network drop.",
])

add_h2("11.2  Common Topics")
checklist([
    "heartbeat topic publishes every 30 s ± 5 s.",
    "router topic publishes every 30 s and contains all required fields.",
    "meter topic publishes every 30-60 s and meter values only increase.",
    "All JSON payloads are valid UTF-8 and parseable.",
    "All timestamps are ISO 8601 formatted.",
])

add_h2("11.3  Path A (Phoenix) — if chosen")
checklist([
    "PowerModule payloads for Head 1 and Head 2 are sent as SEPARATE messages.",
    "Voltage/current values match physical meter readings within ± 2%.",
    "PLC topic publishes at ≥ 1 Hz during active charging.",
    "chargeState transitions correctly: Ready → Connected → Charging → Ready.",
    "Fan RPM keys are exactly \"FAN 1\" through \"FAN 8\".",
    "fault_hb heartbeat topic publishes every 30 s.",
])

add_h2("11.4  Path B (Vector) — if chosen")
checklist([
    "vectorState topic publishes every 1-2 s during active charging.",
    "Idle connectors send null for meas_v / meas_i / soc / etc.",
    "temps.faulty is null OR an array of sensor names — never an empty string.",
    "power_module.modules.per_group has both \"1\" and \"2\" keys, even if a head is empty.",
    "estop_active correctly reports the physical emergency-stop button state.",
    "err_code reports \"...NO_ERROR\" (or equivalent) when no error is active.",
])

add_h2("11.5  Timing & Reliability")
checklist([
    "Under normal operation, no topic exceeds its published cadence limit for > 60 seconds.",
    "Charger survives a 5-minute broker outage and recovers automatically.",
    "Buffered messages older than 5 minutes are dropped on reconnect (do not flood).",
    "NTP sync is active and drift < 30 seconds.",
])

# ═════════════════════════════════════════════════════════════════════════
# 12. DELIVERABLES
# ═════════════════════════════════════════════════════════════════════════

add_h1("Deliverables Checklist", num=12)
add_h2("12.1  From the manufacturer to EDS")
checklist([
    "Confirmation of chosen integration path (Phoenix or Vector).",
    "List of MQTT topic names used per station (topic map).",
    "Sample recorded payloads (5 minutes of MQTT trace) for each topic.",
    "Documented deviations from this specification, if any.",
    "Firmware version identifier and release date.",
    "Contact person for integration support.",
])
add_h2("12.2  From EDS to the manufacturer")
checklist([
    "MQTT broker URL, credentials, and TLS certificates (if applicable).",
    "Assigned Station ID for each charger (before commissioning).",
    "Access to a test/staging FlexxFast instance for pre-production validation.",
    "Sign-off on completed integration tests.",
])

# ═════════════════════════════════════════════════════════════════════════
# 13. CHANGE LOG
# ═════════════════════════════════════════════════════════════════════════

add_h1("Change Log & Version Control", num=13)
add_field_table(
    rows=[
        ("1.0", "2026-06-11", "Initial submission. Covers Phoenix + Vector controllers."),
    ],
    headers=("Version", "Date", "Changes"),
)
add_para(
    "This specification is versioned. Manufacturers should confirm they are working "
    "against the latest version before starting integration work. Contact EDS for "
    "the current revision if unsure.",
    italic=True, color=MUTED,
)

# ═════════════════════════════════════════════════════════════════════════
# 14. SUPPORT
# ═════════════════════════════════════════════════════════════════════════

add_h1("Support & Contact", num=14)
add_para(
    "For clarification, sample payload disputes, or integration issues, contact:"
)
add_para(" ", space_after=2)
add_bullets([
    ("Organization", "EDS Engineering Solutions"),
    ("Platform",     "FlexxFast Monitoring"),
    ("Email",        "____________________"),
    ("Phone",        "____________________"),
    ("Response SLA", "Best-effort within 2 business days for integration inquiries."),
])

page_break()

# ═════════════════════════════════════════════════════════════════════════
# APPENDIX A — Full payload examples
# ═════════════════════════════════════════════════════════════════════════

add_h1("Appendix A. Full Payload Examples", num=None)
add_para(
    "The following are complete, real-world-shaped payloads that the platform has "
    "validated. Manufacturers may use these as reference during firmware "
    "development."
)

add_h2("A.1  Phoenix — Idle charger snapshot")
add_code_block("""\
# heartbeat
{ "heartbeat": 1, "timestamp": "2026-06-11T14:23:45.123456" }

# router
{
  "Status": {
    "connstate":"Connected","temp":460,"rssi":-72,"rsrp":-98,"rsrq":-11,
    "sinr":13,"conntype":"LTE","operator":"AIS","model":"RG5000",
    "manuf":"ExampleCo","imei":"864000000000000","iccid":"89660000000000000000",
    "ip":["10.0.0.10"]
  }
}

# meter
{
  "meter1":131734760,"meter2":119364060,
  "timestamp1":"2026-06-11T14:23:44.501234",
  "timestamp2":"2026-06-11T14:23:44.501289",
  "timestamp": "2026-06-11T14:23:44.501300"
}

# PLC (idle)
{
  "chargeState1":"Ready","chargeState2":"Ready",
  "SOC1":0,"SOC2":0,"powerKw1":0,"powerKw2":0,
  "presentVoltage1":0,"presentCurrent1":0,
  "presentVoltage2":0,"presentCurrent2":0,
  "temp1Head1":38,"temp2Head1":37,"temp1Head2":39,"temp2Head2":38,
  "tempPowerModule1":42,"tempPowerModule2":41,
  "insulationFault1":0,"insulationFault2":0,
  "head1Error":0,"head2Error":0,
  "errorMessage1":"","errorMessage2":"",
  "activeMld1":0,"activeMld2":0,
  "HMI_status":"Active","PLC1_status":"Active","PLC2_status":"Active",
  "fan_status1_8":"0",
  "timestamp":"2026-06-11T14:23:45.101189"
}
""")

add_h2("A.2  Vector — Head 1 charging, Head 2 idle")
add_code_block("""\
{
  "charger": "BKN1",
  "ts": "2026-06-11T14:23:45.409Z",
  "connectors": {
    "1": {
      "cp_state":"state_c","session_state":"CurrentDemand","standard":"din70121",
      "auth_state":"authorized","meas_v":410,"meas_i":110.03,"power_kw":45.10,
      "req_v":453.2,"req_i":110,"soc":63,"ttf_min":41,
      "energy":null,"em_status":null,"ev_max_v":495.1,
      "complete":false,"ev_ready":true,
      "err_code":"VSECCLIB_DC_EVERROR_CODE_TYPE_NO_ERROR",
      "active_failures":[],"pp_state":"disconnected","stale_s":0.1
    },
    "2": {
      "cp_state":"state_a","session_state":null,"standard":"","auth_state":"pending",
      "meas_v":null,"meas_i":null,"power_kw":null,"req_v":null,"req_i":null,
      "soc":null,"ttf_min":null,"energy":null,"em_status":null,"ev_max_v":null,
      "complete":null,"ev_ready":null,"err_code":null,
      "active_failures":[],"pp_state":"disconnected","stale_s":600.5
    }
  },
  "power_module": {
    "status":"operative","max_power_kw_1":50,"max_power_kw_2":75,
    "max_current_1":150,"max_current_2":150,"meas_v":410,"meas_i":110.03,
    "modules": {
      "configured_total":5,"online_total":5,"active_total":2,
      "per_group": {
        "1": {"configured":2,"online":2,"reporting":2,"active":2,"voltage":410,"current":110},
        "2": {"configured":3,"online":3,"reporting":3,"active":0,"voltage":0,"current":0}
      }
    }
  },
  "isolation": {"iso1":1,"iso2":1,"imd_status":"operative"},
  "temps": {"t1":43.61,"t2":39.22,"t3":42.73,"t4":38.52,"faulty":null},
  "emergency":1,
  "estop_active":false,
  "contactor": {"c1":"closed","c2":"open"}
}
""")

# ─── End ───
doc.save(OUT)
print(f"[OK] Saved: {OUT}")
print(f"     Size:  {OUT.stat().st_size / 1024:.1f} KB")
