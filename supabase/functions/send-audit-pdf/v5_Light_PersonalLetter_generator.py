"""
v5 Light Editorial — The Personal Letter
3 pages. Light warm-paper editorial style.
Page 1: Personalized audit (their numbers)
Page 2: The four steps (brief)
Page 3: A note from Greg, with Samantha's call mentioned

SAVED FOR FUTURE USE — not currently wired into the live send-audit-pdf function.
When needed, wire into send-audit-pdf alongside (or instead of) the dark version.
"""
from reportlab.lib.pagesizes import letter
from reportlab.lib.colors import HexColor
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth

# Light editorial palette — warm, paper-like, serious
CREAM      = HexColor("#FAF7F2")  # warm paper
INK_DARK   = HexColor("#1A1A1A")  # near-black for body text
INK_MED    = HexColor("#3A3A3A")
INK_MUTE   = HexColor("#7A7A7A")
RULE       = HexColor("#D6D0C4")
ACCENT_RED = HexColor("#C8102E")  # newsprint red, slightly deeper
PANEL_TAN  = HexColor("#F1ECE2")  # slight contrast for boxes

# Button colors for light version — within editorial palette
BTN_CALL_BG    = HexColor("#C8102E")  # crimson red — primary "try it" action
BTN_CALL_TXT   = HexColor("#FFFFFF")
BTN_DASH_BG    = HexColor("#1E293B")  # deep navy — restrained, sophisticated
BTN_DASH_TXT   = HexColor("#FFFFFF")


def draw_button(c, x, y, w, h, fill_color, text_color, label, url):
    """Draw a clickable button with centered bold label."""
    c.setFillColor(fill_color)
    c.roundRect(x, y, w, h, 8, fill=1, stroke=0)
    c.setFillColor(text_color)
    c.setFont("Helvetica-Bold", 13)
    text_w = stringWidth(label, "Helvetica-Bold", 13)
    text_x = x + (w - text_w) / 2
    text_y = y + h / 2 - 4  # baseline centered
    c.drawString(text_x, text_y, label)
    c.linkURL(url, (x, y, x + w, y + h), relative=0)


SAMPLE = {
    "company_name": "ABC Heating & Air",
    "first_name": "John",
    "prepared_date": "May 14, 2026",
    "missed_calls_per_day": 5,
    "avg_job_value": 350,
    "booking_rate": 35,
    "missed_calls_per_month": 120,
    "lost_jobs_per_month": 42,
    "lost_revenue_per_month": 14700,
    "lost_revenue_per_year": 176400,
}

PAGE_W, PAGE_H = letter
import os

# Logo path - configurable via env var, defaults to local assets folder.
LOGO_PATH = os.environ.get("LOGO_PATH", "./assets/logo_red_on_transparent.png")


def wrap(text, font, size, max_w):
    """Wrap text to fit a max width."""
    words = text.split()
    lines, current = [], ""
    for w in words:
        test = (current + " " + w).strip()
        if stringWidth(test, font, size) <= max_w:
            current = test
        else:
            if current: lines.append(current)
            current = w
    if current: lines.append(current)
    return lines


def fill_page(c):
    c.setFillColor(CREAM)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)


def draw_header(c, data, label):
    c.drawImage(LOGO_PATH, 0.75*inch, PAGE_H - 1.2*inch, width=1.6*inch, height=0.4*inch,
                mask='auto', preserveAspectRatio=True)
    c.setFillColor(INK_MUTE)
    c.setFont("Helvetica", 8)
    c.drawRightString(PAGE_W - 0.75*inch, PAGE_H - 0.95*inch, label.upper())
    c.setFillColor(INK_DARK)
    c.setFont("Helvetica-Bold", 10)
    c.drawRightString(PAGE_W - 0.75*inch, PAGE_H - 1.12*inch, data["company_name"])
    c.setFillColor(INK_MUTE)
    c.setFont("Helvetica", 8)
    c.drawRightString(PAGE_W - 0.75*inch, PAGE_H - 1.27*inch, data["prepared_date"])
    c.setStrokeColor(RULE)
    c.setLineWidth(0.5)
    c.line(0.75*inch, PAGE_H - 1.45*inch, PAGE_W - 0.75*inch, PAGE_H - 1.45*inch)


def draw_footer(c, page_num):
    c.setFillColor(INK_MUTE)
    c.setFont("Helvetica", 8)
    c.drawString(0.75*inch, 0.5*inch, "RELIANT SUPPORT  ·  reliantsupport.net")
    c.drawRightString(PAGE_W - 0.75*inch, 0.5*inch, f"PAGE {page_num} OF 3")


# ============ PAGE 1: THE AUDIT ============
def page_1(c, data):
    fill_page(c)
    draw_header(c, data, "Your Audit")

    y = PAGE_H - 1.9*inch
    c.setFillColor(ACCENT_RED)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(0.75*inch, y, "YOUR MISSED REVENUE")

    c.setFillColor(INK_DARK)
    c.setFont("Times-Bold", 96)
    big = f"${data['lost_revenue_per_month']:,}"
    c.drawString(0.75*inch, y - 1.15*inch, big)

    c.setFillColor(INK_MED)
    c.setFont("Times-Italic", 14)
    c.drawString(0.75*inch, y - 1.45*inch, "per month")

    c.setFillColor(INK_MUTE)
    c.setFont("Helvetica", 11)
    c.drawString(0.75*inch, y - 1.7*inch,
                 f"${data['lost_revenue_per_year']:,} per year if nothing changes.")

    stats_y = y - 2.55*inch
    col_w = (PAGE_W - 1.5*inch - 2 * 0.1*inch) / 3
    stats = [
        (str(data['missed_calls_per_day']),   "MISSED CALLS",      "per day"),
        (str(data['missed_calls_per_month']), "MISSED CALLS",      "per month"),
        (str(data['lost_jobs_per_month']),    "LOST JOBS",         "per month"),
    ]
    for i, (number, label, sub) in enumerate(stats):
        x = 0.75*inch + i * (col_w + 0.1*inch)
        c.setFillColor(PANEL_TAN)
        c.roundRect(x, stats_y - 1.0*inch, col_w, 0.95*inch, 6, fill=1, stroke=0)
        c.setFillColor(ACCENT_RED)
        c.setFont("Times-Bold", 30)
        c.drawString(x + 14, stats_y - 0.45*inch, number)
        c.setFillColor(INK_DARK)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(x + 14, stats_y - 0.66*inch, label)
        c.setFillColor(INK_MUTE)
        c.setFont("Helvetica", 9)
        c.drawString(x + 14, stats_y - 0.82*inch, sub)

    c.setFillColor(INK_MUTE)
    c.setFont("Helvetica-Oblique", 9.5)
    math = (f"{data['missed_calls_per_day']} missed calls/day  x  24 working days  "
            f"x  {data['booking_rate']}% booking rate  x  ${data['avg_job_value']} avg job  "
            f"=  ${data['lost_revenue_per_month']:,} / mo")
    c.drawString(0.75*inch, stats_y - 1.25*inch, math)

    anchor_y = 1.95*inch
    c.setStrokeColor(RULE)
    c.setLineWidth(0.5)
    c.line(0.75*inch, anchor_y + 0.5*inch, PAGE_W - 0.75*inch, anchor_y + 0.5*inch)

    c.setFillColor(INK_DARK)
    c.setFont("Times-Italic", 14)
    c.drawString(0.75*inch, anchor_y + 0.2*inch,
                 "Those calls aren't going to nobody.")
    c.drawString(0.75*inch, anchor_y, "They're going to your competitors.")

    c.setFillColor(INK_MUTE)
    c.setFont("Helvetica", 10)
    c.drawString(0.75*inch, anchor_y - 0.3*inch,
                 "Turn the page for the four things you can do about it.")

    draw_footer(c, 1)


# ============ PAGE 2: THE FOUR STEPS ============
def page_2(c, data):
    fill_page(c)
    draw_header(c, data, "Four Steps")

    y = PAGE_H - 1.9*inch
    c.setFillColor(ACCENT_RED)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(0.75*inch, y, "WHAT YOU CAN DO")

    c.setFillColor(INK_DARK)
    c.setFont("Times-Bold", 28)
    c.drawString(0.75*inch, y - 36, "Four things to fix it.")

    c.setFillColor(INK_MED)
    c.setFont("Times-Italic", 12)
    c.drawString(0.75*inch, y - 60,
                 "Each one helps. Done together, they close the leak entirely.")

    steps_y = y - 1.3*inch
    steps = [
        ("01", "Measure what you're not measuring",
         "Pull your call log and count the misses. Track your booking rate. "
         "Most shop owners have never looked at these numbers -- and what gets "
         "measured gets managed."),

        ("02", "Stop letting calls go to voicemail",
         "Voicemail loses jobs. By the time you call back, your customer has "
         "called someone else. Forward to a person, an answering service, or AI -- "
         "anything but voicemail."),

        ("03", "Systematize the answer",
         "Whoever picks up needs to ask the same questions every time. A simple "
         "script, an on-call rotation, and a way to track where leads come from. "
         "Consistency turns calls into bookings."),

        ("04", "Get out of your own way",
         "Your hourly rate as a tech is worth more than what it costs to hand "
         "off the phone. Stop being your own receptionist."),
    ]

    iy = steps_y
    for num, title, body in steps:
        c.setFillColor(ACCENT_RED)
        c.setFont("Times-Bold", 16)
        c.drawString(0.75*inch, iy, num)

        c.setFillColor(INK_DARK)
        c.setFont("Helvetica-Bold", 13)
        c.drawString(0.95*inch + 10, iy, title)

        c.setFillColor(INK_MED)
        c.setFont("Helvetica", 10.5)
        body_lines = wrap(body, "Helvetica", 10.5, PAGE_W - 2.4*inch)
        by = iy - 18
        for line in body_lines:
            c.drawString(0.95*inch + 10, by, line)
            by -= 14

        iy = by - 22

    draw_footer(c, 2)


# ============ PAGE 3: NOTE FROM GREG ============
def page_3(c, data):
    fill_page(c)
    draw_header(c, data, "A Note From Greg")

    y = PAGE_H - 1.9*inch
    c.setFillColor(ACCENT_RED)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(0.75*inch, y, "FROM THE FOUNDER")

    c.setFillColor(INK_DARK)
    c.setFont("Times-Bold", 26)
    c.drawString(0.75*inch, y - 36, "Why I built this.")

    letter_y = y - 1.0*inch
    paragraphs = [
        ("I spent 25 years in HVAC and another 15 in home services. The phone "
         "problem you just saw the math on was something I lived with for years "
         "before I figured out how to fix it."),

        ("Every answering solution I tried let me down. Voicemail lost jobs. "
         "Answering services took messages but never actually booked anything. "
         "The receptionist I hired was great when she was there and useless when "
         "she wasn't. None of it solved the real problem."),

        ("So I built Reliant Support. It's an AI voice receptionist designed "
         "specifically for HVAC shops. It picks up every unanswered call "
         "instead of going to voicemail. It books appointments straight to "
         "your schedule. It costs less than what you're losing right now."),

        ("If anything in this audit caught your attention, Samantha from our "
         "team will reach out in the next day or two to answer any questions "
         "you have. She's a real person, not a sales pipeline. No pressure, "
         "no follow-up if it's not a fit."),

        ("If you'd rather get a feel for it before Samantha calls, there are "
         "two ways to do that below."),
    ]

    iy = letter_y
    for p in paragraphs:
        c.setFillColor(INK_DARK)
        c.setFont("Times-Roman", 11.5)
        lines = wrap(p, "Times-Roman", 11.5, PAGE_W - 1.5*inch)
        for line in lines:
            c.drawString(0.75*inch, iy, line)
            iy -= 15
        iy -= 8

    iy -= 6
    c.setFillColor(INK_DARK)
    c.setFont("Times-BoldItalic", 18)
    c.drawString(0.75*inch, iy, "-- Greg")
    c.setFillColor(INK_MUTE)
    c.setFont("Helvetica", 10)
    c.drawString(0.75*inch, iy - 18, "Greg MacDonald, Founder")

    btn_y = 2.0*inch
    btn_w = 2.7*inch
    btn_h = 0.55*inch
    gap = 0.2*inch
    total_w = btn_w * 2 + gap
    btn_x_left = (PAGE_W - total_w) / 2
    btn_x_right = btn_x_left + btn_w + gap

    draw_button(c, btn_x_left, btn_y, btn_w, btn_h,
                BTN_CALL_BG, BTN_CALL_TXT,
                "Call the receptionist",
                "https://app.reliantsupport.net/try-receptionist")

    draw_button(c, btn_x_right, btn_y, btn_w, btn_h,
                BTN_DASH_BG, BTN_DASH_TXT,
                "Try the dashboard",
                "https://app.reliantsupport.net/try-demo")

    draw_footer(c, 3)


def build(out_path, data):
    c = canvas.Canvas(out_path, pagesize=letter)
    page_1(c, data); c.showPage()
    page_2(c, data); c.showPage()
    page_3(c, data); c.showPage()
    c.save()
    print(f"Built: {out_path}")


if __name__ == "__main__":
    build("/mnt/user-data/outputs/v5_Light_PersonalLetter.pdf", SAMPLE)
