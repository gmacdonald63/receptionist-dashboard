/**
 * send-audit-pdf
 *
 * Generates a personalized Missed Revenue Audit PDF (v5 Dark 3-page design),
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
} from "https://esm.sh/pdf-lib@1.17.1";

// ── Brand colours ─────────────────────────────────────────────────────────────
const C = {
  navyDark:   rgb(0.008, 0.024, 0.090),   // #020617  page background
  navy:       rgb(0.059, 0.090, 0.165),   // #0F172A  card background
  slate:      rgb(0.118, 0.161, 0.231),   // #1E293B  stat tile background
  slate2:     rgb(0.580, 0.639, 0.722),   // #94A3B8  muted text
  slate3:     rgb(0.796, 0.835, 0.886),   // #CBD5E1  body text on dark
  accentRed:  rgb(0.937, 0.267, 0.267),   // #EF4444
  accentCyan: rgb(0.024, 0.714, 0.831),   // #06B6D4
  white:      rgb(1, 1, 1),
  ruleColor:  rgb(0.157, 0.204, 0.290),   // #283348  dark horizontal rules
};

// ── Page constants ────────────────────────────────────────────────────────────
const PT = 72;
const PW = 612;
const PH = 792;
const ML = 0.75 * PT;    // 54pt left margin
const MR = 0.75 * PT;    // 54pt right margin
const CW = PW - ML - MR; // 504pt content width

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

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
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

// ── PDF Builder ───────────────────────────────────────────────────────────────
class Builder {
  doc!: PDFDocument;
  data!: LeadData;
  bold!: PDFFont;
  regular!: PDFFont;
  italic!: PDFFont;
  boldItalic!: PDFFont;

  async init() {
    this.doc        = await PDFDocument.create();
    this.bold       = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.regular    = await this.doc.embedFont(StandardFonts.Helvetica);
    this.italic     = await this.doc.embedFont(StandardFonts.HelveticaOblique);
    this.boldItalic = await this.doc.embedFont(StandardFonts.HelveticaBoldOblique);
  }

  // Convert "y from top" to pdf-lib "y from bottom"
  yb(fromTop: number): number { return PH - fromTop; }

  // Shared header + footer drawn on every page
  drawChrome(page: PDFPage, pageLabel: string, pageNum: number) {
    const d = this.data;

    // ── Header ──
    // "RELIANT" in red, "SUPPORT" in white, same baseline
    const reliantW = this.bold.widthOfTextAtSize("RELIANT ", 14);
    page.drawText("RELIANT", {
      x: ML, y: this.yb(34),
      font: this.bold, size: 14, color: C.accentRed,
    });
    page.drawText("SUPPORT", {
      x: ML + reliantW, y: this.yb(34),
      font: this.bold, size: 14, color: C.white,
    });
    page.drawText("AI Voice Receptionist for HVAC", {
      x: ML, y: this.yb(48),
      font: this.regular, size: 8, color: C.slate2,
    });

    // Right side: page label, company name, date — all right-aligned
    const labelW   = this.bold.widthOfTextAtSize(pageLabel, 8);
    const companyW = this.bold.widthOfTextAtSize(d.company_name, 11);
    const dateW    = this.regular.widthOfTextAtSize(d.prepared_date, 8);

    page.drawText(pageLabel, {
      x: PW - MR - labelW, y: this.yb(30),
      font: this.bold, size: 8, color: C.slate2,
    });
    page.drawText(d.company_name, {
      x: PW - MR - companyW, y: this.yb(43),
      font: this.bold, size: 11, color: C.white,
    });
    page.drawText(d.prepared_date, {
      x: PW - MR - dateW, y: this.yb(56),
      font: this.regular, size: 8, color: C.slate2,
    });

    // Header rule
    page.drawLine({
      start: { x: ML,       y: this.yb(68) },
      end:   { x: PW - MR,  y: this.yb(68) },
      color: C.ruleColor, thickness: 0.75,
    });

    // ── Footer ──
    page.drawLine({
      start: { x: ML,       y: this.yb(PH - 28) },
      end:   { x: PW - MR,  y: this.yb(PH - 28) },
      color: C.ruleColor, thickness: 0.5,
    });
    page.drawText("RELIANT SUPPORT  |  reliantsupport.net", {
      x: ML, y: this.yb(PH - 16),
      font: this.regular, size: 7, color: C.slate2,
    });
    const pgStr = `PAGE ${pageNum} OF 3`;
    const pgW   = this.bold.widthOfTextAtSize(pgStr, 7);
    page.drawText(pgStr, {
      x: PW - MR - pgW, y: this.yb(PH - 16),
      font: this.bold, size: 7, color: C.slate2,
    });
  }

  // ── Page 1: YOUR AUDIT ────────────────────────────────────────────────────
  page1() {
    const page = this.doc.addPage([PW, PH]);
    const d    = this.data;

    page.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: C.navyDark });
    this.drawChrome(page, "YOUR AUDIT", 1);

    let y = 88;

    // Eyebrow
    page.drawText("YOUR MISSED REVENUE", {
      x: ML, y: this.yb(y),
      font: this.bold, size: 9, color: C.accentCyan,
    });
    y += 16;

    // Giant revenue number
    const revStr  = `$${fmt(d.lost_revenue_per_month)}`;
    const revSize = 64;
    page.drawText(revStr, {
      x: ML, y: this.yb(y + revSize),
      font: this.bold, size: revSize, color: C.accentRed,
    });
    y += revSize + 8;

    // "per month"
    page.drawText("per month", {
      x: ML, y: this.yb(y),
      font: this.regular, size: 16, color: C.white,
    });
    y += 22;

    // Annual figure
    page.drawText(`That's $${fmt(d.lost_revenue_per_year)} per year walking out the door.`, {
      x: ML, y: this.yb(y),
      font: this.italic, size: 10.5, color: C.slate2,
    });
    y += 26;

    // ── Three stat tiles ──
    const tileGap = 8;
    const tileW   = (CW - tileGap * 2) / 3;
    const tileH   = 70;
    const tiles   = [
      { label: "Missed calls/day",   value: fmt(d.missed_calls_per_day) },
      { label: "Missed calls/mo",    value: fmt(d.missed_calls_per_month) },
      { label: "Lost jobs/mo",       value: fmt(d.lost_jobs_per_month) },
    ];

    for (let i = 0; i < 3; i++) {
      const tx = ML + i * (tileW + tileGap);

      page.drawRectangle({
        x: tx, y: this.yb(y + tileH),
        width: tileW, height: tileH,
        color: C.slate,
        borderRadius: 6,
      });

      // Cyan number — centered horizontally, upper third of tile
      const numSize = 26;
      const numStr  = tiles[i].value;
      const numW    = this.bold.widthOfTextAtSize(numStr, numSize);
      page.drawText(numStr, {
        x: tx + (tileW - numW) / 2, y: this.yb(y + 34),
        font: this.bold, size: numSize, color: C.accentCyan,
      });

      // Label — centered horizontally, lower half of tile
      const lblSize = 8.5;
      const lblW    = this.regular.widthOfTextAtSize(tiles[i].label, lblSize);
      page.drawText(tiles[i].label, {
        x: tx + (tileW - lblW) / 2, y: this.yb(y + 54),
        font: this.regular, size: lblSize, color: C.slate2,
      });
    }
    y += tileH + 18;

    // Formula line
    const formula =
      `${fmt(d.missed_calls_per_day)} missed calls/day x 24 days x ` +
      `${d.booking_rate}% booking rate x $${fmt(d.avg_job_value)} avg job value`;
    page.drawText(formula, {
      x: ML, y: this.yb(y),
      font: this.italic, size: 8.5, color: C.slate2,
    });
    y += 22;

    // Horizontal rule
    page.drawLine({
      start: { x: ML,       y: this.yb(y) },
      end:   { x: PW - MR,  y: this.yb(y) },
      color: C.ruleColor, thickness: 0.5,
    });
    y += 20;

    // Quote with left cyan bar
    const quoteLines = [
      "Those calls aren't going to nobody.",
      "They're going to your competitors.",
    ];
    const lineH  = 22;
    const blockH = quoteLines.length * lineH + 8;

    page.drawRectangle({
      x: ML, y: this.yb(y + blockH),
      width: 3, height: blockH,
      color: C.accentCyan,
    });

    let qy = y + 16;
    for (const line of quoteLines) {
      page.drawText(line, {
        x: ML + 14, y: this.yb(qy),
        font: this.boldItalic, size: 14, color: C.white,
      });
      qy += lineH;
    }
    y += blockH + 20;

    // "Turn the page" nudge
    page.drawText("Turn the page -- here's what to do about it.", {
      x: ML, y: this.yb(y),
      font: this.italic, size: 10, color: C.slate2,
    });
  }

  // ── Page 2: FOUR STEPS ────────────────────────────────────────────────────
  page2() {
    const page = this.doc.addPage([PW, PH]);

    page.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: C.navyDark });
    this.drawChrome(page, "FOUR STEPS", 2);

    let y = 88;

    // Eyebrow
    page.drawText("WHAT YOU CAN DO", {
      x: ML, y: this.yb(y),
      font: this.bold, size: 9, color: C.accentCyan,
    });
    y += 16;

    // Headline
    page.drawText("Four things to fix it.", {
      x: ML, y: this.yb(y + 26),
      font: this.bold, size: 30, color: C.white,
    });
    y += 40;

    // Subhead
    const subLines = wrapText(
      "Start with #1 even if you think you've got it covered. The whole thing falls apart if you skip it.",
      10.5, CW
    );
    for (const line of subLines) {
      page.drawText(line, {
        x: ML, y: this.yb(y + 10.5),
        font: this.regular, size: 10.5, color: C.slate3,
      });
      y += 15;
    }
    y += 8;

    // Horizontal rule
    page.drawLine({
      start: { x: ML,       y: this.yb(y) },
      end:   { x: PW - MR,  y: this.yb(y) },
      color: C.ruleColor, thickness: 0.5,
    });
    y += 18;

    const steps = [
      {
        num: "01",
        title: "Measure",
        body: "Pull your missed call count and booking rate. Write them down. You can't fix what you're not tracking, and both numbers are probably worse than you think.",
      },
      {
        num: "02",
        title: "Voicemail",
        body: "Stop letting calls go to voicemail. A customer needing AC repair in July isn't leaving a message -- they're dialing the next company on the list.",
      },
      {
        num: "03",
        title: "Systematize",
        body: "Write a five-line intake script. Set an on-call rotation if you have multiple techs. Build the system once and the phone behaves the same way every time.",
      },
      {
        num: "04",
        title: "Get out of your own way",
        body: "If you're a $150/hr tech spending 2 hrs/day on the phone, you're paying $300/day to be your own receptionist. Almost any answering solution is cheaper than your billable time.",
      },
    ];

    for (const step of steps) {
      const bodyLines = wrapText(step.body, 9.5, CW - 68);
      const cardH     = Math.max(76, 36 + bodyLines.length * 13 + 10);

      page.drawRectangle({
        x: ML, y: this.yb(y + cardH),
        width: CW, height: cardH,
        color: C.navy,
        borderRadius: 6,
      });

      // Big red number — vertically centered on left
      const numSize = 22;
      page.drawText(step.num, {
        x: ML + 14, y: this.yb(y + cardH / 2 + numSize / 2),
        font: this.bold, size: numSize, color: C.accentRed,
      });

      // Title
      page.drawText(step.title, {
        x: ML + 60, y: this.yb(y + 20),
        font: this.bold, size: 13, color: C.white,
      });

      // Body
      let by = y + 36;
      for (const line of bodyLines) {
        page.drawText(line, {
          x: ML + 60, y: this.yb(by),
          font: this.regular, size: 9.5, color: C.slate3,
        });
        by += 13;
      }

      y += cardH + 8;
    }
  }

  // ── Page 3: A NOTE FROM GREG ──────────────────────────────────────────────
  page3() {
    const page = this.doc.addPage([PW, PH]);

    page.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: C.navyDark });
    this.drawChrome(page, "A NOTE FROM GREG", 3);

    let y = 88;

    // Eyebrow
    page.drawText("FROM THE FOUNDER", {
      x: ML, y: this.yb(y),
      font: this.bold, size: 9, color: C.accentCyan,
    });
    y += 16;

    // Headline
    page.drawText("Why I built this.", {
      x: ML, y: this.yb(y + 26),
      font: this.bold, size: 30, color: C.white,
    });
    y += 40;

    // Horizontal rule
    page.drawLine({
      start: { x: ML,       y: this.yb(y) },
      end:   { x: PW - MR,  y: this.yb(y) },
      color: C.ruleColor, thickness: 0.5,
    });
    y += 16;

    const paragraphs = [
      "I spent 25+ years in the HVAC industry. I've run crews, dispatched techs, and answered the phone myself at 11pm because there was nobody else to do it.",
      "I know exactly what it costs when that call doesn't get answered -- not just the job, but the customer you didn't know you lost.",
      "I built Reliant Support because I knew I could put together something better than what was out there. Something that does more than just answer the phone -- it books the job, tracks the customer, and brings your whole operation into one place.",
      "We're not a call center. We're not a voicemail service. We're an AI receptionist that works like a great employee -- one that never calls in sick, never misses a call, and never costs you a $350 job because it wasn't paying attention.",
      "Someone from my team will reach out in the next day or two. If you'd rather not wait, the buttons below will get you there faster.",
    ];

    for (const para of paragraphs) {
      const lines = wrapText(para, 10.5, CW);
      for (const line of lines) {
        page.drawText(line, {
          x: ML, y: this.yb(y + 10.5),
          font: this.regular, size: 10.5, color: C.slate3,
        });
        y += 15;
      }
      y += 8;
    }

    // Signature
    y += 4;
    page.drawText("-- Greg", {
      x: ML, y: this.yb(y + 14),
      font: this.boldItalic, size: 14, color: C.white,
    });
    y += 22;
    page.drawText("Greg MacDonald, Founder", {
      x: ML, y: this.yb(y + 10),
      font: this.regular, size: 9, color: C.slate2,
    });
    y += 24;

    // Rule before CTAs
    page.drawLine({
      start: { x: ML,       y: this.yb(y) },
      end:   { x: PW - MR,  y: this.yb(y) },
      color: C.ruleColor, thickness: 0.5,
    });
    y += 16;

    // Two CTA buttons side by side
    const btnW = (CW - 12) / 2;
    const btnH = 38;

    // Button 1: "Call the receptionist"
    page.drawRectangle({
      x: ML, y: this.yb(y + btnH),
      width: btnW, height: btnH,
      color: C.accentCyan,
      borderRadius: 6,
    });
    const btn1 = "Call the receptionist";
    const btn1W = this.bold.widthOfTextAtSize(btn1, 11);
    page.drawText(btn1, {
      x: ML + (btnW - btn1W) / 2, y: this.yb(y + 23),
      font: this.bold, size: 11, color: C.navyDark,
    });

    // Button 2: "Try the dashboard"
    const btn2X = ML + btnW + 12;
    page.drawRectangle({
      x: btn2X, y: this.yb(y + btnH),
      width: btnW, height: btnH,
      color: C.accentCyan,
      borderRadius: 6,
    });
    const btn2 = "Try the dashboard";
    const btn2W = this.bold.widthOfTextAtSize(btn2, 11);
    page.drawText(btn2, {
      x: btn2X + (btnW - btn2W) / 2, y: this.yb(y + 23),
      font: this.bold, size: 11, color: C.navyDark,
    });

    y += btnH + 10;

    // URL labels under buttons
    const url1 = "reliantsupport.net/demo";
    const url2 = "app.reliantsupport.net";
    const url1W = this.regular.widthOfTextAtSize(url1, 8);
    const url2W = this.regular.widthOfTextAtSize(url2, 8);

    page.drawText(url1, {
      x: ML + (btnW - url1W) / 2, y: this.yb(y),
      font: this.regular, size: 8, color: C.slate2,
    });
    page.drawText(url2, {
      x: btn2X + (btnW - url2W) / 2, y: this.yb(y),
      font: this.regular, size: 8, color: C.slate2,
    });
  }

  async build(data: LeadData): Promise<Uint8Array> {
    this.data = data;
    await this.init();
    this.page1();
    this.page2();
    this.page3();
    return this.doc.save();
  }
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
        "-- Greg",
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
          subject: `Your Missed Revenue Audit -- ${lead.company}`,
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
        subject: `New warm lead: ${lead.company} ($${lostRev}/mo at risk)${pdfFailed ? " -- PDF failed" : ""}`,
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
  const first = trimmed.split(/\s+/)[0];
  if (/^[A-Za-z]{1,20}$/.test(first)) return first;
  return "there";
}
