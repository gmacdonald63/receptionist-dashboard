/**
 * send-audit-pdf
 *
 * Generates a personalized Missed Revenue Audit PDF for a landing_page_leads row,
 * stores it in Supabase Storage, and emails it to the prospect via Resend.
 *
 * Called fire-and-forget from notify-new-lead.
 * On PDF failure: skips the prospect email, includes failure note in Greg's notification.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  rgb,
  StandardFonts,
  degrees,
} from "https://esm.sh/pdf-lib@1.17.1";

// ── Brand colours (match ReportLab source exactly) ──────────────────────────
const C = {
  navy:       rgb(0.059, 0.090, 0.165),   // #0F172A
  navyDark:   rgb(0.008, 0.024, 0.090),   // #020617
  slate:      rgb(0.118, 0.161, 0.231),   // #1E293B
  textDark:   rgb(0.059, 0.090, 0.165),   // #0F172A
  textBody:   rgb(0.200, 0.255, 0.333),   // #334155
  textMute:   rgb(0.392, 0.455, 0.545),   // #64748B
  accentRed:  rgb(0.937, 0.267, 0.267),   // #EF4444
  accentCyan: rgb(0.024, 0.714, 0.831),   // #06B6D4
  rule:       rgb(0.886, 0.910, 0.949),   // #E2E8F0
  panelLight: rgb(0.973, 0.980, 0.988),   // #F8FAFC
  white:      rgb(1, 1, 1),
  slate2:     rgb(0.580, 0.639, 0.722),   // #94A3B8
  slate3:     rgb(0.796, 0.835, 0.886),   // #CBD5E1
  slate4:     rgb(0.400, 0.455, 0.545),   // #64748B  (same as textMute)
};

// ── Page constants ───────────────────────────────────────────────────────────
const PT = 72;                    // points per inch
const PW = 612;                   // letter width  (8.5")
const PH = 792;                   // letter height (11")
const ML = 0.75 * PT;            // left margin
const MR = 0.75 * PT;            // right margin
const MT = 0.75 * PT;            // top margin
const MB = 0.75 * PT;            // bottom margin
const CW = PW - ML - MR;         // content width

// ── Lead data shape ──────────────────────────────────────────────────────────
interface LeadData {
  company_name: string;
  prepared_date: string;
  missed_calls_per_day: number;
  avg_job_value: number;
  booking_rate: number;
  missed_calls_per_month: number;
  lost_jobs_per_month: number;
  lost_revenue_per_month: number;
  lost_revenue_per_year: number;
}

// ── Text helpers ─────────────────────────────────────────────────────────────

/**
 * Wraps text into lines that fit within maxWidth using a simple word-wrap.
 * pdf-lib doesn't have a native measureText on standard fonts for variable widths,
 * so we use an approximate character-width heuristic based on font size.
 * For Helvetica at 10pt, average char width ≈ 5.5pt; scales linearly with size.
 */
function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  // Approximate average char width ratio for Helvetica (empirically tuned)
  const avgCharWidth = fontSize * 0.52;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (test.length * avgCharWidth <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

// ── Layout engine ────────────────────────────────────────────────────────────

class Builder {
  doc: PDFDocument;
  data: LeadData;
  bold!: PDFFont;
  regular!: PDFFont;
  italic!: PDFFont;
  boldItalic!: PDFFont;

  page!: PDFPage;
  pageNum = 0;
  y = 0;   // current Y cursor (from bottom of page, pdf-lib coordinate system)

  async init() {
    this.doc = await PDFDocument.create();
    this.bold      = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.regular   = await this.doc.embedFont(StandardFonts.Helvetica);
    this.italic    = await this.doc.embedFont(StandardFonts.HelveticaOblique);
    this.boldItalic = await this.doc.embedFont(StandardFonts.HelveticaBoldOblique);
  }

  // pdf-lib Y from top: converts "Y from top" to "Y from bottom"
  yb(yFromTop: number): number {
    return PH - yFromTop;
  }

  newPage(drawFooter = true) {
    if (this.pageNum > 0 && drawFooter) this.drawFooter();
    this.page = this.doc.addPage([PW, PH]);
    this.pageNum++;
    this.y = MT;   // cursor tracks distance from top
  }

  drawFooter() {
    const p = this.page;
    p.drawLine({
      start: { x: ML, y: 0.6 * PT },
      end:   { x: PW - MR, y: 0.6 * PT },
      color: C.rule,
      thickness: 0.5,
    });
    p.drawText("Reliant Support  ·  reliantsupport.net", {
      x: ML, y: 0.4 * PT,
      font: this.regular, size: 8,
      color: C.textMute,
    });
    const pageStr = `Page ${this.pageNum}`;
    const w = this.regular.widthOfTextAtSize(pageStr, 8);
    p.drawText(pageStr, {
      x: PW - MR - w, y: 0.4 * PT,
      font: this.regular, size: 8,
      color: C.textMute,
    });
  }

  // Ensure there is enough room below current cursor; add a page if not
  ensureRoom(needed: number) {
    if (this.y + needed > PH - MB - 0.4 * PT) {
      this.newPage();
    }
  }

  // Draw wrapped body text; returns without drawing if text is empty
  drawBody(
    text: string,
    opts: {
      font?: PDFFont;
      size?: number;
      color?: ReturnType<typeof rgb>;
      leading?: number;
      maxWidth?: number;
      x?: number;
      bottomPad?: number;
    } = {}
  ) {
    const font      = opts.font      ?? this.regular;
    const size      = opts.size      ?? 10.5;
    const color     = opts.color     ?? C.textBody;
    const leading   = opts.leading   ?? 14;
    const maxWidth  = opts.maxWidth  ?? CW;
    const x         = opts.x        ?? ML;
    const bottomPad = opts.bottomPad ?? 8;

    const lines = wrapText(text, size, maxWidth);
    this.ensureRoom(leading * lines.length + bottomPad);
    for (const line of lines) {
      this.page.drawText(line, {
        x, y: this.yb(this.y + size),
        font, size, color,
      });
      this.y += leading;
    }
    this.y += bottomPad;
  }

  drawH1(text: string, color = C.textDark) {
    const font = this.bold, size = 22, leading = 28;
    const lines = wrapText(text, size, CW);
    this.ensureRoom(leading * lines.length + 28);
    for (const line of lines) {
      this.page.drawText(line, {
        x: ML, y: this.yb(this.y + size),
        font, size, color,
      });
      this.y += leading;
    }
    this.y += 4;
    // Cyan accent line under heading
    this.page.drawLine({
      start: { x: ML,      y: this.yb(this.y) },
      end:   { x: ML + 50, y: this.yb(this.y) },
      color: C.accentCyan,
      thickness: 2.5,
    });
    this.y += 18;
  }

  drawH2(text: string, color = C.textDark) {
    this.ensureRoom(34);
    this.y += 4;
    this.page.drawText(text, {
      x: ML, y: this.yb(this.y + 14),
      font: this.bold, size: 14, color,
    });
    this.y += 22;
  }

  drawH3(text: string, color = C.textDark) {
    this.ensureRoom(22);
    this.page.drawText(text, {
      x: ML, y: this.yb(this.y + 11.5),
      font: this.bold, size: 11.5, color,
    });
    this.y += 16;
  }

  drawEyebrow(text: string, color = C.accentCyan) {
    this.ensureRoom(14);
    this.page.drawText(text.toUpperCase(), {
      x: ML, y: this.yb(this.y + 8.5),
      font: this.bold, size: 8.5, color,
    });
    this.y += 14;
  }

  drawBullet(text: string, xIndent = 14, fontSize = 10.5, leading = 14) {
    const bulletX = ML + xIndent;
    const textX   = bulletX + 14;
    const maxW    = CW - xIndent - 14;
    const lines   = wrapText(text, fontSize, maxW);
    this.ensureRoom(leading * lines.length + 4);
    // Cyan bullet
    this.page.drawText("•", {
      x: bulletX, y: this.yb(this.y + fontSize),
      font: this.bold, size: 11, color: C.accentCyan,
    });
    for (const line of lines) {
      this.page.drawText(line, {
        x: textX, y: this.yb(this.y + fontSize),
        font: this.regular, size: fontSize, color: C.textBody,
      });
      this.y += leading;
    }
    this.y += 4;
  }

  drawNumbered(n: number, text: string, fontSize = 10.5, leading = 14) {
    const numX  = ML + 14;
    const textX = numX + 18;
    const maxW  = CW - 14 - 18;
    const lines = wrapText(text, fontSize, maxW);
    this.ensureRoom(leading * lines.length + 4);
    this.page.drawText(`${n}.`, {
      x: numX, y: this.yb(this.y + fontSize),
      font: this.bold, size: fontSize, color: C.accentCyan,
    });
    for (const line of lines) {
      this.page.drawText(line, {
        x: textX, y: this.yb(this.y + fontSize),
        font: this.regular, size: fontSize, color: C.textBody,
      });
      this.y += leading;
    }
    this.y += 4;
  }

  drawRule(topPad = 4, bottomPad = 14) {
    this.y += topPad;
    this.ensureRoom(bottomPad);
    this.page.drawLine({
      start: { x: ML,       y: this.yb(this.y) },
      end:   { x: PW - MR, y: this.yb(this.y) },
      color: C.rule,
      thickness: 0.5,
    });
    this.y += bottomPad;
  }

  drawTakeaway(text: string) {
    this.y += 4;
    const lines   = wrapText(text, 10.5, CW - 24);
    const blockH  = lines.length * 14 + 16;
    this.ensureRoom(blockH + 8);
    // Left cyan bar
    this.page.drawRectangle({
      x: ML, y: this.yb(this.y + blockH - 8),
      width: 3, height: blockH - 8,
      color: C.accentCyan,
    });
    for (const line of lines) {
      this.page.drawText(line, {
        x: ML + 16, y: this.yb(this.y + 12),
        font: this.italic, size: 10.5, color: C.textMute,
      });
      this.y += 14;
    }
    this.y += 6;
  }

  // ── COVER ──────────────────────────────────────────────────────────────────
  pageCover() {
    this.page = this.doc.addPage([PW, PH]);
    this.pageNum = 1;
    const p = this.page;
    const d = this.data;

    // Dark navy background
    p.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: C.navyDark });

    // Brand mark
    p.drawText("RELIANT SUPPORT", {
      x: ML, y: this.yb(MT + 6 + 12),
      font: this.bold, size: 12, color: C.white,
    });
    p.drawText("AI Voice Receptionist for HVAC", {
      x: ML, y: this.yb(MT + 22 + 9),
      font: this.regular, size: 9, color: C.accentCyan,
    });

    // Eyebrow
    p.drawText("YOUR MISSED REVENUE AUDIT", {
      x: ML, y: PH / 2 + 100,
      font: this.bold, size: 10, color: C.accentCyan,
    });

    // Main title
    p.drawText("Here's what those", { x: ML, y: PH / 2 + 50,  font: this.bold, size: 38, color: C.white });
    p.drawText("missed calls are",   { x: ML, y: PH / 2 + 10,  font: this.bold, size: 38, color: C.white });
    p.drawText("actually costing you.", { x: ML, y: PH / 2 - 30, font: this.bold, size: 38, color: C.white });

    // Red accent line
    p.drawLine({
      start: { x: ML,       y: PH / 2 - 52 },
      end:   { x: ML + 60, y: PH / 2 - 52 },
      color: C.accentRed,
      thickness: 3,
    });

    // Subtitle
    const subtitleColor = rgb(0.796, 0.835, 0.886); // #CBD5E1
    p.drawText("Your numbers, exposing what's being lost.",       { x: ML, y: PH / 2 - 80,  font: this.regular, size: 12, color: subtitleColor });
    p.drawText("Four steps you need to take to fix the problem.", { x: ML, y: PH / 2 - 100, font: this.regular, size: 12, color: subtitleColor });
    p.drawText("Or one smart choice that will fix it for you.",   { x: ML, y: PH / 2 - 120, font: this.regular, size: 12, color: subtitleColor });

    // Prepared for block
    p.drawText("PREPARED FOR", { x: ML, y: MB + 88, font: this.regular, size: 9, color: C.slate2 });
    p.drawText(d.company_name,  { x: ML, y: MB + 64, font: this.bold,    size: 16, color: C.white });
    p.drawText(`Report date: ${d.prepared_date}`, { x: ML, y: MB + 44, font: this.regular, size: 10, color: C.slate2 });
    p.drawText("Built by Greg — 25+ years in HVAC  ·  reliantsupport.net", {
      x: ML, y: MB + 18,
      font: this.italic, size: 9, color: C.textMute,
    });
  }

  // ── PAGE 2: INTRO ──────────────────────────────────────────────────────────
  pageIntro() {
    this.newPage(false);   // no footer on page after cover
    // Actually draw footer — page_num incremented by newPage
    this.drawEyebrow("What this report is");
    this.drawH1("Four things you can do — and how we'd do it for you.");
    this.drawBody("You ran the calculator. You saw a number. This report puts that number in writing and gives you four things you can do this week to start plugging the leak.");
    this.drawBody("Then it shows you the power of having Reliant Support catch your missed calls — usually for less than it'd cost to have someone in-house do it, and without you having to think about it.");
    this.drawBody("Up to you which route you take. Both are on the table.");
    this.drawRule(8, 18);
    this.drawH3("A note on where this comes from");
    this.drawBody("I've spent my career in the HVAC and home services industries. So I understand how important it is to make sure the phone gets answered when it rings. I've experienced firsthand what it costs when you can't.");
    this.drawBody("I built Reliant Support because I knew I could put together something better than anything else out there. Something that does a lot more than just answer the phone — it brings your customer management and your field operations into one place so your whole business runs more efficiently.", { bottomPad: 4 });
  }

  // ── PAGE 3: NUMBERS ───────────────────────────────────────────────────────
  pageNumbers() {
    this.newPage();
    const d = this.data;
    this.drawEyebrow("Section 1  ·  Your numbers", C.accentCyan);
    this.drawH1("Here's what you're losing.");

    // Big red callout card
    const cardH = 130;
    const cardY = this.y + cardH;
    this.page.drawRectangle({
      x: ML, y: this.yb(cardY),
      width: CW, height: cardH,
      color: C.slate,
      borderRadius: 10,
    });

    this.page.drawText("ESTIMATED LOST REVENUE PER MONTH", {
      x: ML + 24, y: this.yb(this.y + 26),
      font: this.bold, size: 9, color: C.slate2,
    });
    const bigText = `$${fmt(d.lost_revenue_per_month)}`;
    this.page.drawText(bigText, {
      x: ML + 24, y: this.yb(this.y + 88),
      font: this.bold, size: 52, color: C.accentRed,
    });
    this.page.drawText(`That's $${fmt(d.lost_revenue_per_year)} per year walking out the door.`, {
      x: ML + 24, y: this.yb(cardY - 20),
      font: this.regular, size: 12,
      color: rgb(0.886, 0.910, 0.949),
    });
    this.y = cardY + 24;

    this.drawBody(`Based on what you entered — ${d.missed_calls_per_day} missed calls per day, $${fmt(d.avg_job_value)} average job value, and a ${d.booking_rate}% booking rate — your business is leaving about $${fmt(d.lost_revenue_per_month)} a month on the table.`);
    this.drawBody("Not from bad work. Not from bad pricing. From calls that didn't get answered.", { font: this.italic, color: C.textDark, bottomPad: 14 });

    this.drawH3("How we got to that number");
    this.drawBullet(`${d.missed_calls_per_day} missed calls per day × 24 working days = ${fmt(d.missed_calls_per_month)} missed calls per month`);
    this.drawBullet(`${fmt(d.missed_calls_per_month)} missed calls × ${d.booking_rate}% booking rate = ${fmt(d.lost_jobs_per_month)} lost jobs per month`);
    this.drawBullet(`${fmt(d.lost_jobs_per_month)} lost jobs × $${fmt(d.avg_job_value)} average job value = $${fmt(d.lost_revenue_per_month)} per month in lost revenue`);

    this.y += 10;
    this.drawRule(4, 14);
    this.drawBody("That's the number. Next up: four things you can do about it.", { font: this.bold, color: C.textDark, size: 12, bottomPad: 4 });
  }

  // ── SECTION 2 OPENER ─────────────────────────────────────────────────────
  pageSection2Opener() {
    this.newPage();
    this.drawEyebrow("Section 2  ·  What you can do about it", C.accentCyan);
    this.drawH1("Four things, in order.");
    this.drawBody("Start with #1 even if you think you've got it covered. The whole thing falls apart if you skip it.");
    this.drawBody("Each step is something you can do this week without buying anything. Some take an hour. Some take a hard conversation with your team. None of them are theoretical.", { bottomPad: 18 });

    const steps = [
      ["1.", "Measure what you're not measuring"],
      ["2.", "Stop letting calls go to voicemail"],
      ["3.", "Systematize how the phone gets answered"],
      ["4.", "Get out of your own way"],
    ];
    const tocH = steps.length * 24 + 28;
    const cardY = this.y + tocH;
    this.page.drawRectangle({
      x: ML, y: this.yb(cardY),
      width: CW, height: tocH,
      color: C.panelLight,
      borderColor: C.rule,
      borderWidth: 1,
      borderRadius: 8,
    });
    let ty = this.y + 22;
    for (const [num, rest] of steps) {
      this.page.drawText(num, {
        x: ML + 20, y: this.yb(ty),
        font: this.bold, size: 11, color: C.accentCyan,
      });
      this.page.drawText(rest, {
        x: ML + 50, y: this.yb(ty),
        font: this.regular, size: 11, color: C.textDark,
      });
      ty += 24;
    }
    this.y = cardY + 8;
  }

  // ── STEP TEMPLATE ─────────────────────────────────────────────────────────
  drawStep(
    n: number,
    title: string,
    bodyParagraphs: string[],
    actionLabel: string,
    actionSteps: string[],
    takeaway?: string,
  ) {
    this.newPage();
    this.page.drawText(`STEP ${n} OF 4`, {
      x: ML, y: this.yb(this.y + 10),
      font: this.bold, size: 10, color: C.accentCyan,
    });
    this.y += 18;
    this.drawH1(title);
    for (const p of bodyParagraphs) this.drawBody(p);
    this.drawEyebrow(actionLabel, C.textMute);
    actionSteps.forEach((s, i) => this.drawNumbered(i + 1, s));
    if (takeaway) this.drawTakeaway(takeaway);
  }

  // ── BRIDGE PAGE ───────────────────────────────────────────────────────────
  pageBridge() {
    this.newPage();
    this.drawEyebrow("Section 3  ·  Or — let us handle it", C.accentCyan);
    this.drawH1("This is where we fit in.");
    this.drawBody("Those four steps work. The catch is they all need someone to actually do them — measure the missed calls every week, answer the phone every time, keep the script consistent, hold the rotation together, watch the numbers.");
    this.drawBody("That's a job. And if you're the one doing it, it's eating hours out of your day that are worth more than what it'd cost to hand off.");
    this.drawBody("Here's how Reliant Support handles it.", { font: this.bold, color: C.textDark, bottomPad: 16 });

    const colGap = 12;
    const colW   = (CW - colGap * 2) / 3;
    const cardH  = 220;
    const cardY  = this.y + cardH;

    const columns = [
      {
        label: "COVERAGE",
        headline: "Every missed call gets caught.",
        body: "Every call you can't get to is answered, 24/7. Booking rate stays consistent because the AI follows the same script every time. After-hours is covered without an on-call rotation. The dashboard tracks where your leads come from automatically.",
      },
      {
        label: "COST",
        headline: "Less than the labor.",
        body: "A part-time receptionist runs $2,000–$3,000 a month. A traditional answering service runs $400–$800 and doesn't book jobs. Reliant Support starts at $495 a month — and actually books the jobs.",
      },
      {
        label: "TIME",
        headline: "You get out from behind the phone.",
        body: "No more pressure to answer when it's not convenient. And missed calls don't disappear into voicemail anymore. They get answered, booked, and added to your schedule while you're doing something else.",
      },
    ];

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const x   = ML + i * (colW + colGap);

      this.page.drawRectangle({
        x, y: this.yb(cardY),
        width: colW, height: cardH,
        color: C.navyDark,
        borderRadius: 8,
      });

      // Label
      this.page.drawText(col.label, {
        x: x + 14, y: this.yb(this.y + 22),
        font: this.bold, size: 9, color: C.accentCyan,
      });

      // Headline (wrapped to column width)
      const hLines = wrapText(col.headline, 13, colW - 28);
      let hy = this.y + 44;
      for (const line of hLines) {
        this.page.drawText(line, {
          x: x + 14, y: this.yb(hy),
          font: this.bold, size: 13, color: C.white,
        });
        hy += 17;
      }

      // Body
      const bLines = wrapText(col.body, 9.5, colW - 28);
      let by = hy + 10;
      for (const line of bLines) {
        this.page.drawText(line, {
          x: x + 14, y: this.yb(by),
          font: this.regular, size: 9.5,
          color: rgb(0.796, 0.835, 0.886),
        });
        by += 12;
      }
    }

    this.y = cardY + 18;
    this.drawBody("Cheaper than doing it yourself. Cheaper than hiring it out. And you stop being the receptionist.", { font: this.bold, color: C.textDark, size: 12, bottomPad: 4 });
  }

  // ── CLOSING ───────────────────────────────────────────────────────────────
  pageClosing() {
    this.newPage();
    this.drawEyebrow("What happens next", C.accentCyan);
    this.drawH1("Here's how I'd suggest we move forward.");
    this.drawBody("Now that you've seen what those missed calls are costing and what we'd do about it, I think the next step is worth a quick conversation.");
    this.drawBody("Someone from our team will reach out personally in the next day or two — either by phone or email, whichever you respond to first — to walk you through what setup would look like for a shop like yours, answer questions, and see if we're a fit. No high-pressure pitch. If it's not right, we'll tell you that too.");

    // CTA card
    this.y += 6;
    const ctaH  = 140;
    const cardY = this.y + ctaH;
    this.page.drawRectangle({
      x: ML, y: this.yb(cardY),
      width: CW, height: ctaH,
      color: C.navyDark,
      borderRadius: 10,
    });
    this.page.drawText("WANT TO SKIP THE WAIT?", {
      x: ML + 24, y: this.yb(this.y + 26),
      font: this.bold, size: 9, color: C.accentCyan,
    });
    this.page.drawText("Book a walkthrough yourself.", {
      x: ML + 24, y: this.yb(this.y + 56),
      font: this.bold, size: 20, color: C.white,
    });
    this.page.drawText("Pick a time that works for you. 15 minutes. See the dashboard,", {
      x: ML + 24, y: this.yb(this.y + 82),
      font: this.regular, size: 11,
      color: rgb(0.796, 0.835, 0.886),
    });
    this.page.drawText("hear the AI answer a real call, ask whatever you want.", {
      x: ML + 24, y: this.yb(this.y + 98),
      font: this.regular, size: 11,
      color: rgb(0.796, 0.835, 0.886),
    });
    this.page.drawText("reliantsupport.net/demo", {
      x: ML + 24, y: this.yb(cardY - 24),
      font: this.bold, size: 12, color: C.accentCyan,
    });
    this.y = cardY + 24;

    this.drawH3("A few things to know before we talk");
    this.drawBullet("Setup takes about a week. We do the work; you review and approve.");
    this.drawBullet("Month-to-month. No long contracts. Cancel anytime if it's not working.");
    this.drawBullet("First 30 days are guaranteed — if it doesn't pay for itself, we refund it.");

    this.y += 4;
    this.drawRule(4, 14);

    this.page.drawText("Talk soon,", {
      x: ML, y: this.yb(this.y + 13),
      font: this.boldItalic, size: 13, color: C.textDark,
    });
    this.y += 24;
    this.page.drawText("— Greg", {
      x: ML, y: this.yb(this.y + 14),
      font: this.bold, size: 14, color: C.textDark,
    });
    this.y += 18;
    this.page.drawText("Founder, Reliant Support", {
      x: ML, y: this.yb(this.y + 10),
      font: this.regular, size: 10, color: C.textMute,
    });
    this.y += 24;
  }

  // ── BUILD ─────────────────────────────────────────────────────────────────
  async build(data: LeadData): Promise<Uint8Array> {
    this.data = data;
    await this.init();

    this.pageCover();
    this.pageIntro();
    this.pageNumbers();
    this.pageSection2Opener();

    this.drawStep(1, "Measure what you're not measuring.",
      [
        "Most owners are guessing on two numbers that should be the foundation of how they run the phone: how many calls they're actually missing, and what their booking rate is on the ones they answer.",
        "Both numbers are usually worse than the guess. You can't fix what you haven't measured.",
      ],
      "Do this week",
      [
        "Pull last month's call log from your phone provider. Count the calls marked missed, unanswered, or under 5 seconds. Divide by 30. That's your real missed-call rate per day.",
        "Of the last 50 calls you did answer, count how many became scheduled jobs. Divide by 50. That's your booking rate.",
        "Write both numbers down. They're the baseline that you can use to measure against.",
      ],
      "If you are missing calls, you are leaving money on the table. If you don't know these numbers, you don't know how much.",
    );

    this.drawStep(2, "Stop letting calls go to voicemail.",
      [
        "Voicemail in home services is pointless. The customer needing AC repair in July isn't leaving a message and waiting — they're hanging up and dialing the next company on the list.",
        "Your phone needs to be answered every time it rings. You need a backup plan for when you aren't able to do it.",
      ],
      "Your real options",
      [
        "Forward to a backup person — spouse, office manager, retired tech. Cheapest. Works if they're reliable, trained, and always available.",
        "Use a traditional answering service. Real humans, but they don't book jobs — they just take messages and pass them along. By the time you call back, the customer has booked someone else. Not much better than voicemail. Plus the per-minute pricing adds up.",
        "Use an AI receptionist. Picks up every call, 24/7. Books the job on the spot. No sick days, no missed nights, no per-minute fees, and no relying on someone else to be available. Often cheaper than both options above — and the jobs it captures usually pay for it several times over.",
      ],
      "Whatever you pick, pick something. Voicemail isn't a choice. It's a leak.",
    );

    this.drawStep(3, "Systematize how the phone gets answered.",
      [
        "If everyone who answers your phone is winging it, your booking rate is suffering. Same goes for after-hours, where most shops just hope somebody picks up. And same goes for tracking where your calls come from — most owners genuinely don't know.",
        "All three are the same problem: no system. Fix the system once and the phone starts behaving the same way every time.",
      ],
      "Build the system",
      [
        "Write a five-line intake script — greeting, address, callback number, urgency, booking. Tape it next to the phone. Everyone reads from the same card.",
        "Set up an on-call rotation if you have more than one tech. Written. Paid stipend. Phone forwards to whoever's up that week.",
        "Add one line to the script: \"How'd you hear about us?\" Write down the answer every time. After 30 days, you'll know where your money is actually coming from.",
      ],
      "A good system will answer the phone the same way at 9 a.m. as it does at 9 p.m.",
    );

    this.drawStep(4, "Get out of your own way.",
      [
        "This one is more mindset than tactic. Hard to do, but a good system makes it easier.",
        "Most owners in this trade are technicians first and businesspeople second. They got into it because they're good with their hands, and they default to doing everything themselves.",
        "If you're a $150/hour tech and you spend two hours a day on the phone, you're costing the business $300 a day to be your own receptionist. That's $7,200 a month. Almost any answering solution out there is cheaper than your billable time.",
      ],
      "The math test",
      [
        "Track every minute you spend on the phone for one week.",
        "Multiply by your hourly billable rate.",
        "Compare to what an answering service or AI receptionist costs per month.",
      ],
      "The math rarely favors the owner answering the phone himself. Shops that grow are the ones that hand it off.",
    );

    this.pageBridge();
    this.pageClosing();

    // Draw footer on last page
    this.drawFooter();

    return this.doc.save();
  }
}

// ── CORS headers ─────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let leadId: string | undefined;
  let pdfFailed = false;
  let pdfFailReason = "";

  try {
    ({ lead_id: leadId } = await req.json());

    // 1. Fetch lead
    const { data: lead, error: fetchErr } = await supabase
      .from("landing_page_leads")
      .select("*")
      .eq("id", leadId)
      .single();

    if (fetchErr || !lead) throw new Error(`Lead not found: ${leadId}`);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.warn("RESEND_API_KEY not set — skipping all emails");
      return new Response(JSON.stringify({ skipped: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Prepare data for PDF
    const today = new Date();
    const preparedDate = today.toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    });

    const pdfData: LeadData = {
      company_name:            lead.company,
      prepared_date:           preparedDate,
      missed_calls_per_day:    lead.missed_calls_per_day,
      avg_job_value:           Number(lead.avg_job_value),
      booking_rate:            Number(lead.booking_rate),
      missed_calls_per_month:  lead.missed_calls_per_month,
      lost_jobs_per_month:     lead.lost_jobs_per_month,
      lost_revenue_per_month:  Number(lead.lost_revenue_per_month),
      lost_revenue_per_year:   Number(lead.lost_revenue_per_month) * 12,
    };

    // 3. Generate PDF
    let pdfBytes: Uint8Array | null = null;
    let storagePath: string | null = null;

    try {
      const builder = new Builder();
      pdfBytes = await builder.build(pdfData);

      // 4. Upload to Supabase Storage
      storagePath = `audit-pdfs/${leadId}.pdf`;
      const { error: uploadErr } = await supabase.storage
        .from("audit-pdfs")
        .upload(`${leadId}.pdf`, pdfBytes, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

      // 5. Update lead row with storage path
      await supabase
        .from("landing_page_leads")
        .update({ pdf_storage_path: storagePath })
        .eq("id", leadId);

    } catch (pdfErr) {
      pdfFailed = true;
      pdfFailReason = (pdfErr as Error).message;
      console.error("PDF generation/upload failed:", pdfErr);
    }

    // 6a. Email the prospect (only if PDF succeeded)
    if (!pdfFailed && pdfBytes) {
      const firstName = parseFirstName(lead.name);
      const lostRev   = Number(lead.lost_revenue_per_month).toLocaleString("en-US");

      const prospectText = [
        `Hi ${firstName},`,
        "",
        "Thanks for running the calculator at reliantsupport.net. Your personalized",
        "Missed Revenue Audit is attached.",
        "",
        "Inside you'll find:",
        `  - Your numbers in writing ($${lostRev}/month estimated lost revenue)`,
        "  - Four things you can do this week to start plugging the leak",
        "  - How Reliant Support would handle it for you if you'd rather not do it",
        "    yourself",
        "",
        "I'll reach out personally in the next day or two to see if there are any",
        "questions I can answer. If you'd rather skip the wait and grab a time",
        "yourself, you can book a 15-minute walkthrough here:",
        "",
        "reliantsupport.net/demo",
        "",
        "Talk soon,",
        "",
        "— Greg",
        "Founder, Reliant Support",
        "reliantsupport.net",
      ].join("\n");

      const pdfBase64 = btoa(String.fromCharCode(...pdfBytes));

      const prospectRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Greg at Reliant Support <noreply@reliantsupport.net>",
          reply_to: "greg@reliantsupport.net",
          to: [lead.email],
          subject: `Your Missed Revenue Audit — ${lead.company}`,
          text: prospectText,
          attachments: [
            {
              filename: `Missed_Revenue_Audit_${lead.company.replace(/\s+/g, "_")}.pdf`,
              content: pdfBase64,
            },
          ],
        }),
      });

      if (prospectRes.ok) {
        await supabase
          .from("landing_page_leads")
          .update({ prospect_email_sent_at: new Date().toISOString() })
          .eq("id", leadId);
      } else {
        const errBody = await prospectRes.text();
        console.error("Prospect email send failed:", errBody);
      }
    }

    // 6b. Internal notification to Greg (always fires)
    const source   = lead.utm_source  || "direct";
    const campaign = lead.utm_campaign || "-";
    const lostRev  = Number(lead.lost_revenue_per_month).toLocaleString("en-US");

    let gregText = `
New lead from /missed-revenue:

Name:    ${lead.name}
Company: ${lead.company}
Email:   ${lead.email}
Phone:   ${lead.phone}

Their calculator results:
  Missed calls/mo:  ${lead.missed_calls_per_month}
  Lost jobs/mo:     ${lead.lost_jobs_per_month}
  Lost revenue/mo:  $${lostRev}

Source: ${source} / ${campaign}

Lead in dashboard: https://app.reliantsupport.net/leads/${lead.id}
    `.trim();

    if (pdfFailed) {
      gregText += `\n\n⚠️  PDF GENERATION FAILED — please send manually.\nError: ${pdfFailReason}`;
    } else {
      gregText += `\n\nPDF stored at: ${storagePath}`;
    }

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Reliant Support <noreply@reliantsupport.net>",
        to: ["greg@reliantsupport.net"],
        subject: `🔥 New warm lead: ${lead.company} ($${lostRev}/mo at risk)${pdfFailed ? " ⚠️ PDF failed" : ""}`,
        text: gregText,
      }),
    });

    // TODO: Add Samantha's email or SMS notification here when she's onboarded

    return new Response(
      JSON.stringify({ sent: true, pdf_failed: pdfFailed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("send-audit-pdf error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseFirstName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "there";
  // If first token looks like a name word (no numbers, not all caps), use it
  const first = trimmed.split(/\s+/)[0];
  if (/^[A-Za-z]{1,20}$/.test(first)) return first;
  return "there";
}
