/**
 * track-calculator-engagement
 *
 * Calculator engagement tracking — fires at three points in the prospect journey:
 *
 *   trigger="clicked" : prospect clicked the calculator link in a cold email
 *     → upserts HubSpot contact (Lead Status: "Clicked")
 *     → creates deal at Clicked Link stage (skips if a deal already exists)
 *
 *   trigger="engaged" : prospect changed a calculator field before submitting the form
 *     → upserts HubSpot contact (Lead Status: "Clicked")
 *     → upgrades existing deal to Ran Numbers, OR creates at Ran Numbers if none exists
 *
 *   trigger="warm" : prospect submitted the form and PDF was delivered
 *     → upserts HubSpot contact (Lead Status: "Warm")
 *     → upgrades existing deal to Sent Report, OR creates at Sent Report if none exists
 *
 * Required env vars:
 *   HUBSPOT_PRIVATE_APP_TOKEN     HubSpot private app token
 *   HUBSPOT_SALES_PIPELINE_ID     "Reliant Support Sales" pipeline ID
 *   HUBSPOT_STAGE_CLICKED         Stage ID for "Clicked Link" in that pipeline
 *   HUBSPOT_STAGE_ENGAGED         Stage ID for "Ran Numbers" in that pipeline
 *   HUBSPOT_STAGE_WARM_LEAD       Stage ID for "Sent Report" in that pipeline
 *
 * Fails soft — errors are logged but never bubble up to the caller.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HUBSPOT_BASE   = "https://api.hubapi.com";
const HS_ACCOUNT_ID  = "245657284";
const CONTACT_TO_DEAL_ASSOC_TYPE_ID = 4; // HubSpot-defined: contact_to_deal

interface ClickedPayload {
  trigger: "clicked";
  email: string;
}

interface EngagedPayload {
  trigger: "engaged";
  email: string;
  missed_calls_per_day?: number;
  avg_job_value?: number;
  booking_rate?: number;
  lost_revenue_per_month?: number;
}

interface WarmPayload {
  trigger: "warm";
  email: string;
  name?: string;
  company?: string;
  phone?: string;
  missed_calls_per_day?: number;
  avg_job_value?: number;
  booking_rate?: number;
  lost_revenue_per_month?: number;
  pdf_sent_at?: string;
}

interface TrackResult {
  tracked: boolean;
  contact_id?: string;
  deal_id?: string;
  deal_url?: string;
  reason?: string;
  error?: string;
}

async function hs(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${HUBSPOT_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(`HubSpot ${method} ${path} → ${res.status}: ${text}`);
    (err as Error & { status?: number; body?: unknown }).status = res.status;
    (err as Error & { status?: number; body?: unknown }).body = data;
    throw err;
  }
  return data;
}

function parseName(full: string): { first: string; last: string } {
  const parts = (full || "").trim().split(/\s+/);
  return { first: parts[0] || "", last: parts.slice(1).join(" ") };
}

async function upsertContact(
  token: string,
  email: string,
  leadStatus: string,
  extra?: { name?: string; phone?: string; company?: string },
): Promise<string> {
  const { first, last } = parseName(extra?.name || "");

  const props: Record<string, string> = {
    email,
    hs_lead_status: leadStatus,
    lifecyclestage: "lead",
  };
  if (first) props.firstname = first;
  if (last)  props.lastname  = last;
  if (extra?.phone)   props.phone   = extra.phone;
  if (extra?.company) props.company = extra.company;

  // Search by email first to avoid unnecessary 409s
  const searchRes = await hs(token, "POST", "/crm/v3/objects/contacts/search", {
    filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
    properties: ["email"],
    limit: 1,
  });
  const existing = searchRes.results?.[0];

  if (existing) {
    await hs(token, "PATCH", `/crm/v3/objects/contacts/${existing.id}`, { properties: props });
    return existing.id as string;
  }

  try {
    const created = await hs(token, "POST", "/crm/v3/objects/contacts", { properties: props });
    return created.id as string;
  } catch (err) {
    const e = err as Error & { status?: number; body?: { message?: string } };
    if (e.status === 409) {
      const m = (e.body?.message || "").match(/Existing ID:\s*(\d+)/i);
      if (m) {
        const id = m[1];
        await hs(token, "PATCH", `/crm/v3/objects/contacts/${id}`, { properties: props });
        return id;
      }
    }
    throw err;
  }
}

async function getContactDealIds(token: string, contactId: string): Promise<string[]> {
  try {
    const res = await hs(token, "GET", `/crm/v4/objects/contact/${contactId}/associations/deal`);
    return (res.results || []).map((r: { toObjectId: number }) => String(r.toObjectId));
  } catch {
    return [];
  }
}

async function createAndAssociateDeal(
  token: string,
  contactId: string,
  pipelineId: string,
  stageId: string,
  dealName: string,
  description: string,
): Promise<string> {
  const closeDate = String(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const deal = await hs(token, "POST", "/crm/v3/objects/deals", {
    properties: { dealname: dealName, dealstage: stageId, pipeline: pipelineId, closedate: closeDate, description },
  });
  const dealId = deal.id as string;

  await hs(token, "PUT", `/crm/v4/objects/contact/${contactId}/associations/deal/${dealId}`, [
    { associationCategory: "HUBSPOT_DEFINED", associationTypeId: CONTACT_TO_DEAL_ASSOC_TYPE_ID },
  ]);

  return dealId;
}

function buildDealUrl(dealId: string): string {
  return `https://app.hubspot.com/contacts/${HS_ACCOUNT_ID}/deal/${dealId}`;
}

function fmtMoney(n: number | undefined): string {
  return n != null ? `$${Math.round(n).toLocaleString("en-US")}` : "—";
}

function fmtRate(n: number | undefined): string {
  return n != null ? `${n}%` : "—";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const respond = (result: TrackResult, status = 200) =>
    new Response(JSON.stringify(result), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  let payload: ClickedPayload | EngagedPayload | WarmPayload;
  try {
    payload = await req.json();
  } catch {
    return respond({ tracked: false, reason: "invalid JSON" }, 400);
  }

  const { trigger, email } = payload;

  if (!email) return respond({ tracked: false, reason: "email required" }, 400);
  if (trigger !== "clicked" && trigger !== "engaged" && trigger !== "warm") {
    return respond({ tracked: false, reason: "trigger must be 'clicked', 'engaged', or 'warm'" }, 400);
  }

  const token      = Deno.env.get("HUBSPOT_PRIVATE_APP_TOKEN");
  const pipelineId = Deno.env.get("HUBSPOT_SALES_PIPELINE_ID");
  const clickedId  = Deno.env.get("HUBSPOT_STAGE_CLICKED");
  const engagedId  = Deno.env.get("HUBSPOT_STAGE_ENGAGED");
  const warmLeadId = Deno.env.get("HUBSPOT_STAGE_WARM_LEAD");

  if (!token || !pipelineId || !clickedId || !engagedId || !warmLeadId) {
    const missing = [
      !token      && "HUBSPOT_PRIVATE_APP_TOKEN",
      !pipelineId && "HUBSPOT_SALES_PIPELINE_ID",
      !clickedId  && "HUBSPOT_STAGE_CLICKED",
      !engagedId  && "HUBSPOT_STAGE_ENGAGED",
      !warmLeadId && "HUBSPOT_STAGE_WARM_LEAD",
    ].filter(Boolean).join(", ");
    console.warn(`track-calculator-engagement skipped: missing ${missing}`);
    return respond({ tracked: false, reason: `missing env vars: ${missing}` });
  }

  try {
    // ── CLICKED ───────────────────────────────────────────────────────────────
    if (trigger === "clicked") {
      const contactId = await upsertContact(token, email, "Clicked");

      // Only create a deal if none already exists for this contact
      const existingDealIds = await getContactDealIds(token, contactId);
      if (existingDealIds.length > 0) {
        return respond({ tracked: true, contact_id: contactId, reason: "deal already exists — skipped" });
      }

      const dealName    = `${email.split("@")[0]} — Clicked Link`;
      const description = "Prospect clicked the calculator link in a cold email.";
      const dealId      = await createAndAssociateDeal(token, contactId, pipelineId, clickedId, dealName, description);

      return respond({ tracked: true, contact_id: contactId, deal_id: dealId, deal_url: buildDealUrl(dealId) });
    }

    // ── ENGAGED (Ran Numbers) ─────────────────────────────────────────────────
    if (trigger === "engaged") {
      const p = payload as EngagedPayload;

      const contactId = await upsertContact(token, email, "Clicked");

      const existingDealIds = await getContactDealIds(token, contactId);

      const description = [
        "Prospect ran numbers in the missed revenue calculator.",
        "",
        "Their numbers:",
        `  Missed calls/day: ${p.missed_calls_per_day ?? "—"}`,
        `  Avg job value: ${fmtMoney(p.avg_job_value)}`,
        `  Booking rate: ${fmtRate(p.booking_rate)}`,
        `  Estimated lost revenue/month: ${fmtMoney(p.lost_revenue_per_month)}`,
        "",
        "They changed the default values but did not request the PDF report.",
      ].join("\n");

      if (existingDealIds.length > 0) {
        // Upgrade existing deal to Ran Numbers
        const dealId = existingDealIds[0];
        await hs(token, "PATCH", `/crm/v3/objects/deals/${dealId}`, {
          properties: { dealstage: engagedId, description },
        });
        return respond({ tracked: true, contact_id: contactId, deal_id: dealId, deal_url: buildDealUrl(dealId) });
      }

      // No prior deal — create at Ran Numbers directly
      const dealName = `${email.split("@")[0]} — Ran Numbers`;
      const dealId   = await createAndAssociateDeal(token, contactId, pipelineId, engagedId, dealName, description);

      return respond({ tracked: true, contact_id: contactId, deal_id: dealId, deal_url: buildDealUrl(dealId) });
    }

    // ── WARM (Sent Report) ────────────────────────────────────────────────────
    const p = payload as WarmPayload;

    const contactId = await upsertContact(token, email, "Warm", {
      name:    p.name,
      phone:   p.phone,
      company: p.company,
    });

    const existingDealIds = await getContactDealIds(token, contactId);

    const warmDescription = [
      "Prospect submitted the calculator form and requested the PDF report.",
      `PDF delivered: ${p.pdf_sent_at || new Date().toISOString()}`,
      "",
      "Their numbers:",
      `  Missed calls/day: ${p.missed_calls_per_day ?? "—"}`,
      `  Avg job value: ${fmtMoney(p.avg_job_value)}`,
      `  Booking rate: ${fmtRate(p.booking_rate)}`,
      `  Estimated lost revenue/month: ${fmtMoney(p.lost_revenue_per_month)}`,
    ].join("\n");

    let dealId: string;

    if (existingDealIds.length > 0) {
      // Upgrade existing deal to Sent Report
      dealId = existingDealIds[0];
      const properties: Record<string, string> = {
        dealstage:   warmLeadId,
        description: warmDescription,
      };
      // Update deal name to include company now that we have it
      if (p.company) properties.dealname = `${p.company} — Sent Report`;
      await hs(token, "PATCH", `/crm/v3/objects/deals/${dealId}`, { properties });
    } else {
      // Prospect submitted without any prior interaction — create at Sent Report directly
      const dealName = p.company ? `${p.company} — Sent Report` : `${email} — Sent Report`;
      dealId = await createAndAssociateDeal(token, contactId, pipelineId, warmLeadId, dealName, warmDescription);
    }

    return respond({ tracked: true, contact_id: contactId, deal_id: dealId, deal_url: buildDealUrl(dealId) });

  } catch (err) {
    const msg = (err as Error).message;
    console.error(`track-calculator-engagement [${trigger}] error:`, msg);
    return respond({ tracked: false, error: msg });
  }
});
