/**
 * Standalone PDF generation test — no emails, no Supabase, no HubSpot.
 * Direct port of v5_Dark_PersonalLetter_generator.py using pdf-lib.
 * Run: node test-pdf-gen.mjs
 * Output: test-output.pdf
 */
import { PDFDocument, rgb, StandardFonts, PDFName, PDFString } from "pdf-lib";
import { readFileSync, writeFileSync } from "fs";

// ── Dark palette (exact hex from Python source) ────────────────────────────
// NAVY_DARK  = #0A0E1A
// NAVY       = #13192B
// SLATE_BG   = #1A2238
// TEXT_WHITE = #FFFFFF
// TEXT_LIGHT = #CBD5E1
// TEXT_MUTE  = #94A3B8
// ACCENT_RED = #E11D48
// ACCENT_CYAN= #22D3EE
// RULE       = #2D3748
// BTN_CALL_BG = #22D3EE  BTN_CALL_TXT = #0A0E1A
// BTN_DASH_BG = #3B82F6  BTN_DASH_TXT = #FFFFFF

function hex(h) {
  const r = parseInt(h.slice(1, 3), 16) / 255;
  const g = parseInt(h.slice(3, 5), 16) / 255;
  const b = parseInt(h.slice(5, 7), 16) / 255;
  return rgb(r, g, b);
}

const NAVY_DARK   = hex("#0A0E1A");
const NAVY        = hex("#13192B");
const SLATE_BG    = hex("#1A2238");
const TEXT_WHITE  = hex("#FFFFFF");
const TEXT_LIGHT  = hex("#CBD5E1");
const TEXT_MUTE   = hex("#94A3B8");
const ACCENT_RED  = hex("#E11D48");
const ACCENT_CYAN = hex("#22D3EE");
const RULE        = hex("#2D3748");
const BTN_CALL_BG = hex("#22D3EE");
const BTN_CALL_TXT= hex("#0A0E1A");
const BTN_DASH_BG = hex("#3B82F6");
const BTN_DASH_TXT= hex("#FFFFFF");

// ── Page constants (letter = 8.5" × 11") ──────────────────────────────────
const PAGE_W = 612;
const PAGE_H = 792;
const INCH   = 72;

// ── Logo PNG (loaded from file for the test script) ────────────────────────
const LOGO_PNG_PATH = "/tmp/logo_red.png";

// ── Text helpers ───────────────────────────────────────────────────────────

// Port of Python's wrap(text, font, size, max_w) — uses real font metrics
function wrap(font, text, size, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

// Port of ReportLab's drawRightString(x, y, text) — right-aligns at x
function drawRightString(page, font, size, color, rightX, y, text) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: rightX - w, y, font, size, color });
}

// Port of ReportLab's linkURL — adds a clickable URI annotation to the page
function addLink(page, x, y, width, height, url) {
  const doc = page.doc;
  const annot = doc.context.obj({
    Type:    PDFName.of("Annot"),
    Subtype: PDFName.of("Link"),
    Rect:    doc.context.obj([x, y, x + width, y + height]),
    Border:  doc.context.obj([0, 0, 0]),
    A: doc.context.obj({
      Type: PDFName.of("Action"),
      S:    PDFName.of("URI"),
      URI:  PDFString.of(url),
    }),
  });
  const ref = doc.context.register(annot);
  const existing = page.node.get(PDFName.of("Annots"));
  if (existing) {
    existing.push(ref);
  } else {
    page.node.set(PDFName.of("Annots"), doc.context.obj([ref]));
  }
}

// Port of draw_button()
function drawButton(page, fonts, x, y, w, h, fillColor, textColor, label, url) {
  // Rounded rect background
  page.drawRectangle({ x, y, width: w, height: h, color: fillColor, borderRadius: 8 });
  // Centered label
  const font = fonts.bold;
  const size = 13;
  const textW = font.widthOfTextAtSize(label, size);
  const textX = x + (w - textW) / 2;
  const textY = y + h / 2 - 4;  // baseline centered — matches Python exactly
  page.drawText(label, { x: textX, y: textY, font, size, color: textColor });
  // Clickable link
  addLink(page, x, y, w, h, url);
}

// ── fill_page — dark outer + inner panel ──────────────────────────────────
function fillPage(page) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: NAVY_DARK });
  page.drawRectangle({
    x: 0.4 * INCH, y: 0.4 * INCH,
    width: PAGE_W - 0.8 * INCH, height: PAGE_H - 0.8 * INCH,
    color: NAVY,
  });
}

// ── draw_header — logo + right-side meta + rule ────────────────────────────
async function drawHeader(page, fonts, logoImage, data, label) {
  // Logo: x=0.75", y=PAGE_H-1.2" (bottom of image), 1.6"×0.4"
  page.drawImage(logoImage, {
    x:      0.75 * INCH,
    y:      PAGE_H - 1.2 * INCH,
    width:  1.6 * INCH,
    height: 0.4 * INCH,
  });

  // Right-side: label, company, date — all right-aligned at PAGE_W - 0.75"
  const rightX = PAGE_W - 0.75 * INCH;
  drawRightString(page, fonts.regular, 8, TEXT_MUTE,  rightX, PAGE_H - 0.95 * INCH, label.toUpperCase());
  drawRightString(page, fonts.bold,    10, TEXT_LIGHT, rightX, PAGE_H - 1.12 * INCH, data.company_name);
  drawRightString(page, fonts.regular, 8, TEXT_MUTE,  rightX, PAGE_H - 1.27 * INCH, data.prepared_date);

  // Header rule
  page.drawLine({
    start:     { x: 0.75 * INCH, y: PAGE_H - 1.45 * INCH },
    end:       { x: rightX,      y: PAGE_H - 1.45 * INCH },
    color:     RULE,
    thickness: 0.5,
  });
}

// ── draw_footer ────────────────────────────────────────────────────────────
function drawFooter(page, fonts, pageNum) {
  const y = 0.5 * INCH;
  page.drawText("RELIANT SUPPORT  \xb7  reliantsupport.net", {
    x: 0.75 * INCH, y, font: fonts.regular, size: 8, color: TEXT_MUTE,
  });
  drawRightString(page, fonts.regular, 8, TEXT_MUTE,
    PAGE_W - 0.75 * INCH, y, `PAGE ${pageNum} OF 3`);
}

// ── PAGE 1: THE AUDIT ─────────────────────────────────────────────────────
async function page1(doc, fonts, logoImage, data) {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  fillPage(page);
  await drawHeader(page, fonts, logoImage, data, "Your Audit");

  // y = PAGE_H - 1.9" — anchor for all page-1 content
  const y = PAGE_H - 1.9 * INCH;  // 655.2 pt from bottom

  // Eyebrow
  page.drawText("YOUR MISSED REVENUE", {
    x: 0.75 * INCH, y,
    font: fonts.bold, size: 9, color: ACCENT_CYAN,
  });

  // Massive revenue number — font 96, y - 1.15"
  page.drawText(`$${data.lost_revenue_per_month.toLocaleString("en-US")}`, {
    x: 0.75 * INCH, y: y - 1.15 * INCH,
    font: fonts.bold, size: 96, color: ACCENT_RED,
  });

  // "per month" — font 14, y - 1.45"
  page.drawText("per month", {
    x: 0.75 * INCH, y: y - 1.45 * INCH,
    font: fonts.regular, size: 14, color: TEXT_LIGHT,
  });

  // Annual figure — font 11, y - 1.7"
  page.drawText(
    `$${data.lost_revenue_per_year.toLocaleString("en-US")} per year if nothing changes.`,
    { x: 0.75 * INCH, y: y - 1.7 * INCH, font: fonts.regular, size: 11, color: TEXT_MUTE }
  );

  // ── Stats row ──
  const statsY = y - 2.55 * INCH;  // 471.6 pt from bottom
  const colW   = (PAGE_W - 1.5 * INCH - 2 * 0.1 * INCH) / 3;  // 163.2 pt
  const stats  = [
    { number: String(data.missed_calls_per_day),   label: "MISSED CALLS", sub: "per day"   },
    { number: String(data.missed_calls_per_month), label: "MISSED CALLS", sub: "per month" },
    { number: String(data.lost_jobs_per_month),    label: "LOST JOBS",    sub: "per month" },
  ];

  for (let i = 0; i < 3; i++) {
    const x = 0.75 * INCH + i * (colW + 0.1 * INCH);
    const s = stats[i];

    // Rounded tile background
    page.drawRectangle({
      x, y: statsY - 1.0 * INCH,
      width: colW, height: 0.95 * INCH,
      color: SLATE_BG, borderRadius: 6,
    });

    // Number — font 30 bold, ACCENT_CYAN
    page.drawText(s.number, {
      x: x + 14, y: statsY - 0.45 * INCH,
      font: fonts.bold, size: 30, color: ACCENT_CYAN,
    });
    // Label — font 9 bold, TEXT_LIGHT
    page.drawText(s.label, {
      x: x + 14, y: statsY - 0.66 * INCH,
      font: fonts.bold, size: 9, color: TEXT_LIGHT,
    });
    // Sub — font 9, TEXT_MUTE
    page.drawText(s.sub, {
      x: x + 14, y: statsY - 0.82 * INCH,
      font: fonts.regular, size: 9, color: TEXT_MUTE,
    });
  }

  // Math formula — font 9.5 italic, y = statsY - 1.25"
  const math =
    `${data.missed_calls_per_day} missed calls/day  x  24 working days  ` +
    `x  ${data.booking_rate}% booking rate  x  $${data.avg_job_value} avg job  ` +
    `=  $${data.lost_revenue_per_month.toLocaleString("en-US")} / mo`;
  page.drawText(math, {
    x: 0.75 * INCH, y: statsY - 1.25 * INCH,
    font: fonts.italic, size: 9.5, color: TEXT_MUTE,
  });

  // ── Anchor line + quote at bottom ──
  const anchorY = 1.95 * INCH;  // 140.4 pt from bottom

  page.drawLine({
    start:     { x: 0.75 * INCH,         y: anchorY + 0.5 * INCH },
    end:       { x: PAGE_W - 0.75 * INCH, y: anchorY + 0.5 * INCH },
    color:     RULE, thickness: 0.5,
  });

  // Quote — font 13 italic (Helvetica-Oblique), TEXT_LIGHT
  page.drawText("Those calls aren't going to nobody.", {
    x: 0.75 * INCH, y: anchorY + 0.2 * INCH,
    font: fonts.italic, size: 13, color: TEXT_LIGHT,
  });
  page.drawText("They're going to your competitors.", {
    x: 0.75 * INCH, y: anchorY,
    font: fonts.italic, size: 13, color: TEXT_LIGHT,
  });

  // "Turn the page" — font 10, TEXT_MUTE, y = anchorY - 0.3"
  page.drawText("Turn the page for the four things you can do about it.", {
    x: 0.75 * INCH, y: anchorY - 0.3 * INCH,
    font: fonts.regular, size: 10, color: TEXT_MUTE,
  });

  drawFooter(page, fonts, 1);
}

// ── PAGE 2: THE FOUR STEPS ────────────────────────────────────────────────
// Note: steps are NOT in boxes — number + title + body text only (spec requirement)
async function page2(doc, fonts, logoImage, data) {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  fillPage(page);
  await drawHeader(page, fonts, logoImage, data, "Four Steps");

  const y = PAGE_H - 1.9 * INCH;  // 655.2 pt from bottom

  // Eyebrow
  page.drawText("WHAT YOU CAN DO", {
    x: 0.75 * INCH, y,
    font: fonts.bold, size: 9, color: ACCENT_CYAN,
  });

  // Headline — font 28 bold, y - 36
  page.drawText("Four things to fix it.", {
    x: 0.75 * INCH, y: y - 36,
    font: fonts.bold, size: 28, color: TEXT_WHITE,
  });

  // Subhead — font 11, y - 60
  page.drawText("Each one helps. Done together, they close the leak entirely.", {
    x: 0.75 * INCH, y: y - 60,
    font: fonts.regular, size: 11, color: TEXT_MUTE,
  });

  // ── Four steps ── (no boxes, just flowing text)
  const stepsY = y - 1.3 * INCH;  // 561.6 pt from bottom
  const bodyMaxW = PAGE_W - 2.4 * INCH;   // 439.2 pt — matches Python exactly
  const bodyX    = 0.95 * INCH + 8;        // 76.4 pt — matches Python exactly

  const steps = [
    {
      num: "01", title: "Measure what you're not measuring",
      body: "Pull your call log and count the misses. Track your booking rate. "
          + "Most shop owners have never looked at these numbers -- and what gets "
          + "measured gets managed.",
    },
    {
      num: "02", title: "Stop letting calls go to voicemail",
      body: "Voicemail loses jobs. By the time you call back, your customer has "
          + "called someone else. Forward to a person, an answering service, or AI -- "
          + "anything but voicemail.",
    },
    {
      num: "03", title: "Systematize the answer",
      body: "Whoever picks up needs to ask the same questions every time. A simple "
          + "script, an on-call rotation, and a way to track where leads come from. "
          + "Consistency turns calls into bookings.",
    },
    {
      num: "04", title: "Get out of your own way",
      body: "Your hourly rate as a tech is worth more than what it costs to hand "
          + "off the phone. Stop being your own receptionist.",
    },
  ];

  let iy = stepsY;
  for (const step of steps) {
    // Number — font 14 bold, ACCENT_RED
    page.drawText(step.num, {
      x: 0.75 * INCH, y: iy,
      font: fonts.bold, size: 14, color: ACCENT_RED,
    });
    // Title — font 13 bold, TEXT_WHITE
    page.drawText(step.title, {
      x: bodyX, y: iy,
      font: fonts.bold, size: 13, color: TEXT_WHITE,
    });
    // Body — font 10.5, TEXT_LIGHT, wrapped to bodyMaxW, starting at iy - 18
    const bodyLines = wrap(fonts.regular, step.body, 10.5, bodyMaxW);
    let by = iy - 18;
    for (const line of bodyLines) {
      page.drawText(line, {
        x: bodyX, y: by,
        font: fonts.regular, size: 10.5, color: TEXT_LIGHT,
      });
      by -= 14;
    }
    iy = by - 22;
  }

  drawFooter(page, fonts, 2);
}

// ── PAGE 3: A NOTE FROM GREG ──────────────────────────────────────────────
async function page3(doc, fonts, logoImage, data) {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  fillPage(page);
  await drawHeader(page, fonts, logoImage, data, "A Note From Greg");

  const y = PAGE_H - 1.9 * INCH;  // 655.2 pt from bottom

  // Eyebrow
  page.drawText("FROM THE FOUNDER", {
    x: 0.75 * INCH, y,
    font: fonts.bold, size: 9, color: ACCENT_CYAN,
  });

  // Headline — font 26 bold, y - 36
  page.drawText("Why I built this.", {
    x: 0.75 * INCH, y: y - 36,
    font: fonts.bold, size: 26, color: TEXT_WHITE,
  });

  // ── The letter ──
  const letterY  = y - 1.0 * INCH;  // 583.2 pt from bottom
  const bodyMaxW = PAGE_W - 1.5 * INCH;  // 504 pt — matches Python exactly

  const paragraphs = [
    "I spent 25 years in HVAC and another 15 in home services. The phone "
    + "problem you just saw the math on was something I lived with for years "
    + "before I figured out how to fix it.",

    "Every answering solution I tried let me down. Voicemail lost jobs. "
    + "Answering services took messages but never actually booked anything. "
    + "The receptionist I hired was great when she was there and useless when "
    + "she wasn't. None of it solved the real problem.",

    "So I built Reliant Support. It's an AI voice receptionist designed "
    + "specifically for HVAC shops. It picks up every unanswered call "
    + "instead of going to voicemail. It books appointments straight to "
    + "your schedule. It costs less than what you're losing right now.",

    "If anything in this audit caught your attention, Samantha from our "
    + "team will reach out in the next day or two to answer any questions "
    + "you have. She's a real person, not a sales pipeline. No pressure, "
    + "no follow-up if it's not a fit.",

    "If you'd rather get a feel for it before Samantha calls, there are "
    + "two ways to do that below.",
  ];

  // font: Helvetica, 11 — matches Python exactly
  let iy = letterY;
  for (const p of paragraphs) {
    const lines = wrap(fonts.regular, p, 11, bodyMaxW);
    for (const line of lines) {
      page.drawText(line, {
        x: 0.75 * INCH, y: iy,
        font: fonts.regular, size: 11, color: TEXT_LIGHT,
      });
      iy -= 15;
    }
    iy -= 8;
  }

  // Signature — font 16 bold-oblique, matches Python's Helvetica-BoldOblique 16
  iy -= 6;
  page.drawText("-- Greg", {
    x: 0.75 * INCH, y: iy,
    font: fonts.boldItalic, size: 16, color: TEXT_WHITE,
  });
  page.drawText("Greg MacDonald, Founder", {
    x: 0.75 * INCH, y: iy - 18,
    font: fonts.regular, size: 10, color: TEXT_MUTE,
  });

  // ── Side-by-side buttons ──
  // Matches Python exactly: btn_y=2.0", btn_w=2.7", btn_h=0.55", gap=0.2"
  // Centered horizontally on the page
  const btnY    = 2.0 * INCH;    // 144 pt
  const btnW    = 2.7 * INCH;    // 194.4 pt
  const btnH    = 0.55 * INCH;   // 39.6 pt
  const gap     = 0.2 * INCH;    // 14.4 pt
  const totalW  = btnW * 2 + gap;
  const btnXL   = (PAGE_W - totalW) / 2;   // 104.4 pt
  const btnXR   = btnXL + btnW + gap;       // 313.2 pt

  // Button 1 — "Call the receptionist" — cyan bg, dark navy text
  drawButton(page, fonts, btnXL, btnY, btnW, btnH,
    BTN_CALL_BG, BTN_CALL_TXT,
    "Call the receptionist",
    "https://app.reliantsupport.net/try-receptionist");

  // Button 2 — "Try the dashboard" — slate blue bg, white text
  drawButton(page, fonts, btnXR, btnY, btnW, btnH,
    BTN_DASH_BG, BTN_DASH_TXT,
    "Try the dashboard",
    "https://app.reliantsupport.net/try-demo");

  drawFooter(page, fonts, 3);
}

// ── Build ──────────────────────────────────────────────────────────────────
async function build(data) {
  const doc = await PDFDocument.create();

  // Embed fonts
  const fonts = {
    regular:   await doc.embedFont(StandardFonts.Helvetica),
    bold:      await doc.embedFont(StandardFonts.HelveticaBold),
    italic:    await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic:await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };

  // Embed logo PNG
  const logoPngBytes = readFileSync(LOGO_PNG_PATH);
  const logoImage    = await doc.embedPng(logoPngBytes);

  await page1(doc, fonts, logoImage, data);
  await page2(doc, fonts, logoImage, data);
  await page3(doc, fonts, logoImage, data);

  return doc.save();
}

// ── Sample data ────────────────────────────────────────────────────────────
const SAMPLE = {
  company_name:            "Test HVAC Co",
  prepared_date:           new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  missed_calls_per_day:    5,
  avg_job_value:           350,
  booking_rate:            35,
  missed_calls_per_month:  120,
  lost_jobs_per_month:     42,
  lost_revenue_per_month:  14700,
  lost_revenue_per_year:   176400,
};

const bytes = await build(SAMPLE);
writeFileSync("test-output.pdf", bytes);
console.log(`PDF written: test-output.pdf (${bytes.length} bytes, ${Math.round(bytes.length/1024)}KB)`);
