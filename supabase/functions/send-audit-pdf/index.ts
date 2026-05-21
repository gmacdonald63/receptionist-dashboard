/**
 * send-audit-pdf
 *
 * Generates a personalized Missed Revenue Audit PDF (v5 Dark Personal Letter),
 * stores it in Supabase Storage, and emails it to the prospect via Resend.
 *
 * PDF design is a direct port of v5_Dark_PersonalLetter_generator.py.
 * Called fire-and-forget from notify-new-lead.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  PDFDocument,
  PDFName,
  PDFString,
  rgb,
  StandardFonts,
} from "https://esm.sh/pdf-lib@1.17.1";

// ── Dark palette (exact hex from approved Python source) ───────────────────
function hex(h: string) {
  return rgb(
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255,
  );
}

const NAVY_DARK   = hex("#0A0E1A");
const NAVY        = hex("#13192B");
const SLATE_BG    = hex("#1A2238");
const TEXT_WHITE  = hex("#FFFFFF");
const TEXT_LIGHT  = hex("#CBD5E1");
const TEXT_MUTE   = hex("#94A3B8");
const ACCENT_RED  = hex("#E11D48");
const ACCENT_CYAN = hex("#22D3EE");
const RULE_COLOR  = hex("#2D3748");
const BTN_CALL_BG = hex("#22D3EE");
const BTN_CALL_TXT= hex("#0A0E1A");
const BTN_DASH_BG = hex("#3B82F6");
const BTN_DASH_TXT= hex("#FFFFFF");

// ── Page constants (letter = 8.5" × 11") ──────────────────────────────────
const PAGE_W = 612;
const PAGE_H = 792;
const INCH   = 72;

// ── Logo PNG embedded as base64 ────────────────────────────────────────────
// Generated from src/assets/RELIANT SUPPORT LOGO.svg at 460×115px (4× resolution)
const LOGO_BASE64 =
  "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" +
  "gg==";

// ── Lead data shape ───────────────────────────────────────────────────────────
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

// ── Text helpers ───────────────────────────────────────────────────────────────

// Port of Python's wrap() — uses real font metrics for accurate wrapping
function wrap(font: any, text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
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

// Port of ReportLab's drawRightString() — right-aligns text at rightX
function drawRightString(page: any, font: any, size: number, color: any, rightX: number, y: number, text: string) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: rightX - w, y, font, size, color });
}

// Port of ReportLab's linkURL() — adds a clickable URI annotation
function addLink(page: any, x: number, y: number, width: number, height: number, url: string) {
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

// Port of Python's draw_button()
function drawButton(
  page: any, fonts: any,
  x: number, y: number, w: number, h: number,
  fillColor: any, textColor: any, label: string, url: string
) {
  page.drawRectangle({ x, y, width: w, height: h, color: fillColor, borderRadius: 8 });
  const textW = fonts.bold.widthOfTextAtSize(label, 13);
  const textX = x + (w - textW) / 2;
  const textY = y + h / 2 - 4;
  page.drawText(label, { x: textX, y: textY, font: fonts.bold, size: 13, color: textColor });
  addLink(page, x, y, w, h, url);
}

// ── fill_page — dark outer border + lighter inner panel ───────────────────────
function fillPage(page: any) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: NAVY_DARK });
  page.drawRectangle({
    x: 0.4 * INCH, y: 0.4 * INCH,
    width: PAGE_W - 0.8 * INCH, height: PAGE_H - 0.8 * INCH,
    color: NAVY,
  });
}

// ── draw_header — logo + right-side meta + rule ───────────────────────────────
function drawHeader(page: any, fonts: any, logoImage: any, data: LeadData, label: string) {
  page.drawImage(logoImage, {
    x:      0.75 * INCH,
    y:      PAGE_H - 1.2 * INCH,
    width:  1.6 * INCH,
    height: 0.4 * INCH,
  });

  const rightX = PAGE_W - 0.75 * INCH;
  drawRightString(page, fonts.regular, 8, TEXT_MUTE,  rightX, PAGE_H - 0.95 * INCH, label.toUpperCase());
  drawRightString(page, fonts.bold,    10, TEXT_LIGHT, rightX, PAGE_H - 1.12 * INCH, data.company_name);
  drawRightString(page, fonts.regular, 8, TEXT_MUTE,  rightX, PAGE_H - 1.27 * INCH, data.prepared_date);

  page.drawLine({
    start:     { x: 0.75 * INCH, y: PAGE_H - 1.45 * INCH },
    end:       { x: rightX,      y: PAGE_H - 1.45 * INCH },
    color:     RULE_COLOR, thickness: 0.5,
  });
}

// ── draw_footer ───────────────────────────────────────────────────────────────
function drawFooter(page: any, fonts: any, pageNum: number) {
  const y = 0.5 * INCH;
  page.drawText("RELIANT SUPPORT  \xb7  reliantsupport.net", {
    x: 0.75 * INCH, y, font: fonts.regular, size: 8, color: TEXT_MUTE,
  });
  drawRightString(page, fonts.regular, 8, TEXT_MUTE,
    PAGE_W - 0.75 * INCH, y, `PAGE ${pageNum} OF 3`);
}

// ── PAGE 1: THE AUDIT ─────────────────────────────────────────────────────────
function page1(doc: any, fonts: any, logoImage: any, data: LeadData) {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  fillPage(page);
  drawHeader(page, fonts, logoImage, data, "Your Audit");

  const y = PAGE_H - 1.9 * INCH;  // 655.2 pt from bottom

  page.drawText("YOUR MISSED REVENUE", {
    x: 0.75 * INCH, y, font: fonts.bold, size: 9, color: ACCENT_CYAN,
  });

  page.drawText(`$${data.lost_revenue_per_month.toLocaleString("en-US")}`, {
    x: 0.75 * INCH, y: y - 1.15 * INCH,
    font: fonts.bold, size: 96, color: ACCENT_RED,
  });

  page.drawText("per month", {
    x: 0.75 * INCH, y: y - 1.45 * INCH,
    font: fonts.regular, size: 14, color: TEXT_LIGHT,
  });

  page.drawText(
    `$${data.lost_revenue_per_year.toLocaleString("en-US")} per year if nothing changes.`,
    { x: 0.75 * INCH, y: y - 1.7 * INCH, font: fonts.regular, size: 11, color: TEXT_MUTE }
  );

  // ── Stats row ──
  const statsY = y - 2.55 * INCH;
  const colW   = (PAGE_W - 1.5 * INCH - 2 * 0.1 * INCH) / 3;
  const stats  = [
    { number: String(data.missed_calls_per_day),   label: "MISSED CALLS", sub: "per day"   },
    { number: String(data.missed_calls_per_month), label: "MISSED CALLS", sub: "per month" },
    { number: String(data.lost_jobs_per_month),    label: "LOST JOBS",    sub: "per month" },
  ];

  for (let i = 0; i < 3; i++) {
    const x = 0.75 * INCH + i * (colW + 0.1 * INCH);
    const s = stats[i];
    page.drawRectangle({
      x, y: statsY - 1.0 * INCH,
      width: colW, height: 0.95 * INCH,
      color: SLATE_BG, borderRadius: 6,
    });
    page.drawText(s.number, { x: x + 14, y: statsY - 0.45 * INCH, font: fonts.bold,    size: 30, color: ACCENT_CYAN });
    page.drawText(s.label,  { x: x + 14, y: statsY - 0.66 * INCH, font: fonts.bold,    size: 9,  color: TEXT_LIGHT  });
    page.drawText(s.sub,    { x: x + 14, y: statsY - 0.82 * INCH, font: fonts.regular, size: 9,  color: TEXT_MUTE   });
  }

  // Math formula
  const math =
    `${data.missed_calls_per_day} missed calls/day  x  24 working days  ` +
    `x  ${data.booking_rate}% booking rate  x  $${data.avg_job_value} avg job  ` +
    `=  $${data.lost_revenue_per_month.toLocaleString("en-US")} / mo`;
  page.drawText(math, {
    x: 0.75 * INCH, y: statsY - 1.25 * INCH,
    font: fonts.italic, size: 9.5, color: TEXT_MUTE,
  });

  // ── Anchor quote at bottom ──
  const anchorY = 1.95 * INCH;
  page.drawLine({
    start: { x: 0.75 * INCH, y: anchorY + 0.5 * INCH },
    end:   { x: PAGE_W - 0.75 * INCH, y: anchorY + 0.5 * INCH },
    color: RULE_COLOR, thickness: 0.5,
  });
  page.drawText("Those calls aren't going to nobody.", {
    x: 0.75 * INCH, y: anchorY + 0.2 * INCH,
    font: fonts.italic, size: 13, color: TEXT_LIGHT,
  });
  page.drawText("They're going to your competitors.", {
    x: 0.75 * INCH, y: anchorY,
    font: fonts.italic, size: 13, color: TEXT_LIGHT,
  });
  page.drawText("Turn the page for the four things you can do about it.", {
    x: 0.75 * INCH, y: anchorY - 0.3 * INCH,
    font: fonts.regular, size: 10, color: TEXT_MUTE,
  });

  drawFooter(page, fonts, 1);
}

// ── PAGE 2: THE FOUR STEPS ────────────────────────────────────────────────────
// Steps are plain text — no boxes (per spec)
function page2(doc: any, fonts: any, logoImage: any, data: LeadData) {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  fillPage(page);
  drawHeader(page, fonts, logoImage, data, "Four Steps");

  const y = PAGE_H - 1.9 * INCH;

  page.drawText("WHAT YOU CAN DO", {
    x: 0.75 * INCH, y, font: fonts.bold, size: 9, color: ACCENT_CYAN,
  });
  page.drawText("Four things to fix it.", {
    x: 0.75 * INCH, y: y - 36, font: fonts.bold, size: 28, color: TEXT_WHITE,
  });
  page.drawText("Each one helps. Done together, they close the leak entirely.", {
    x: 0.75 * INCH, y: y - 60, font: fonts.regular, size: 11, color: TEXT_MUTE,
  });

  const stepsY   = y - 1.3 * INCH;
  const bodyMaxW = PAGE_W - 2.4 * INCH;
  const bodyX    = 0.95 * INCH + 8;

  const steps = [
    {
      num: "01", title: "Measure what you're not measuring",
      body: "Pull your call log and count the misses. Track your booking rate. "
          + "Most shop owners have never looked at these numbers -- and what gets measured gets managed.",
    },
    {
      num: "02", title: "Stop letting calls go to voicemail",
      body: "Voicemail loses jobs. By the time you call back, your customer has called someone else. "
          + "Forward to a person, an answering service, or AI -- anything but voicemail.",
    },
    {
      num: "03", title: "Systematize the answer",
      body: "Whoever picks up needs to ask the same questions every time. A simple script, "
          + "an on-call rotation, and a way to track where leads come from. Consistency turns calls into bookings.",
    },
    {
      num: "04", title: "Get out of your own way",
      body: "Your hourly rate as a tech is worth more than what it costs to hand off the phone. "
          + "Stop being your own receptionist.",
    },
  ];

  let iy = stepsY;
  for (const step of steps) {
    page.drawText(step.num,   { x: 0.75 * INCH, y: iy, font: fonts.bold, size: 14, color: ACCENT_RED  });
    page.drawText(step.title, { x: bodyX,        y: iy, font: fonts.bold, size: 13, color: TEXT_WHITE  });
    const bodyLines = wrap(fonts.regular, step.body, 10.5, bodyMaxW);
    let by = iy - 18;
    for (const line of bodyLines) {
      page.drawText(line, { x: bodyX, y: by, font: fonts.regular, size: 10.5, color: TEXT_LIGHT });
      by -= 14;
    }
    iy = by - 22;
  }

  drawFooter(page, fonts, 2);
}

// ── PAGE 3: A NOTE FROM GREG ──────────────────────────────────────────────────
function page3(doc: any, fonts: any, logoImage: any, data: LeadData) {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  fillPage(page);
  drawHeader(page, fonts, logoImage, data, "A Note From Greg");

  const y = PAGE_H - 1.9 * INCH;

  page.drawText("FROM THE FOUNDER", {
    x: 0.75 * INCH, y, font: fonts.bold, size: 9, color: ACCENT_CYAN,
  });
  page.drawText("Why I built this.", {
    x: 0.75 * INCH, y: y - 36, font: fonts.bold, size: 26, color: TEXT_WHITE,
  });

  const letterY  = y - 1.0 * INCH;
  const bodyMaxW = PAGE_W - 1.5 * INCH;

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

  let iy = letterY;
  for (const p of paragraphs) {
    const lines = wrap(fonts.regular, p, 11, bodyMaxW);
    for (const line of lines) {
      page.drawText(line, { x: 0.75 * INCH, y: iy, font: fonts.regular, size: 11, color: TEXT_LIGHT });
      iy -= 15;
    }
    iy -= 8;
  }

  iy -= 6;
  page.drawText("-- Greg", {
    x: 0.75 * INCH, y: iy, font: fonts.boldItalic, size: 16, color: TEXT_WHITE,
  });
  page.drawText("Greg MacDonald, Founder", {
    x: 0.75 * INCH, y: iy - 18, font: fonts.regular, size: 10, color: TEXT_MUTE,
  });

  // ── Side-by-side buttons (centered, matching Python dimensions exactly) ──
  const btnY   = 2.0 * INCH;
  const btnW   = 2.7 * INCH;
  const btnH   = 0.55 * INCH;
  const gap    = 0.2 * INCH;
  const totalW = btnW * 2 + gap;
  const btnXL  = (PAGE_W - totalW) / 2;
  const btnXR  = btnXL + btnW + gap;

  drawButton(page, fonts, btnXL, btnY, btnW, btnH,
    BTN_CALL_BG, BTN_CALL_TXT,
    "Call the receptionist",
    "https://app.reliantsupport.net/try-receptionist");

  drawButton(page, fonts, btnXR, btnY, btnW, btnH,
    BTN_DASH_BG, BTN_DASH_TXT,
    "Try the dashboard",
    "https://app.reliantsupport.net/try-demo");

  drawFooter(page, fonts, 3);
}

// ── PDF builder ───────────────────────────────────────────────────────────────
async function buildPdf(data: LeadData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = {
    regular:    await doc.embedFont(StandardFonts.Helvetica),
    bold:       await doc.embedFont(StandardFonts.HelveticaBold),
    italic:     await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };

  // Decode base64 logo and embed as PNG
  const logoBytes  = Uint8Array.from(atob(LOGO_BASE64), c => c.charCodeAt(0));
  const logoImage  = await doc.embedPng(logoBytes);

  page1(doc, fonts, logoImage, data);
  page2(doc, fonts, logoImage, data);
  page3(doc, fonts, logoImage, data);

  return doc.save();
}

// ── CORS headers ──────────────────────────────────────────────────────────────
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

    let pdfBytes: Uint8Array | null = null;
    let storagePath: string | null = null;

    try {
      pdfBytes = await buildPdf(pdfData);

      storagePath = `audit-pdfs/${leadId}.pdf`;
      const { error: uploadErr } = await supabase.storage
        .from("audit-pdfs")
        .upload(`${leadId}.pdf`, pdfBytes, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

      await supabase
        .from("landing_page_leads")
        .update({ pdf_storage_path: storagePath })
        .eq("id", leadId);

    } catch (pdfErr) {
      pdfFailed = true;
      pdfFailReason = (pdfErr as Error).message;
      console.error("PDF generation/upload failed:", pdfErr);
    }

    // Email prospect (only if PDF succeeded)
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
        "  - How Reliant Support would handle it for you if you'd rather not",
        "    do it yourself",
        "",
        "I'll reach out personally in the next day or two. If you'd rather skip",
        "the wait, you can book a 15-minute walkthrough here:",
        "",
        "reliantsupport.net/demo",
        "",
        "Talk soon,",
        "",
        "-- Greg",
        "Founder, Reliant Support",
        "reliantsupport.net",
      ].join("\n");

      const pdfBase64 = btoa(String.fromCharCode(...pdfBytes));

      const prospectRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from:      "Greg at Reliant Support <noreply@reliantsupport.net>",
          reply_to:  "greg@reliantsupport.net",
          to:        [lead.email],
          subject:   `Your Missed Revenue Audit -- ${lead.company}`,
          text:      prospectText,
          attachments: [{
            filename: `Missed_Revenue_Audit_${lead.company.replace(/\s+/g, "_")}.pdf`,
            content:  pdfBase64,
          }],
        }),
      });

      if (prospectRes.ok) {
        await supabase
          .from("landing_page_leads")
          .update({ prospect_email_sent_at: new Date().toISOString() })
          .eq("id", leadId);
      } else {
        console.error("Prospect email failed:", await prospectRes.text());
      }
    }

    // Internal notification to Greg (always fires)
    const source   = lead.utm_source  || "direct";
    const campaign = lead.utm_campaign || "-";
    const lostRev  = Number(lead.lost_revenue_per_month).toLocaleString("en-US");

    let gregText = `
New lead from /missed-revenue:

Name:    ${lead.name}
Company: ${lead.company}
Email:   ${lead.email}
Phone:   ${lead.phone}

Calculator results:
  Missed calls/mo:  ${lead.missed_calls_per_month}
  Lost jobs/mo:     ${lead.lost_jobs_per_month}
  Lost revenue/mo:  $${lostRev}

Source: ${source} / ${campaign}
    `.trim();

    if (pdfFailed) {
      gregText += `\n\n⚠️  PDF GENERATION FAILED — please send manually.\nError: ${pdfFailReason}`;
    } else {
      gregText += `\n\nPDF stored at: ${storagePath}`;
    }

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from:    "Reliant Support <noreply@reliantsupport.net>",
        to:      ["greg@reliantsupport.net"],
        subject: `New warm lead: ${lead.company} ($${lostRev}/mo at risk)${pdfFailed ? " -- PDF failed" : ""}`,
        text:    gregText,
      }),
    });

    // TODO: Add Samantha's notification here when she's onboarded

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
  const first = trimmed.split(/\s+/)[0];
  if (/^[A-Za-z]{1,20}$/.test(first)) return first;
  return "there";
}
