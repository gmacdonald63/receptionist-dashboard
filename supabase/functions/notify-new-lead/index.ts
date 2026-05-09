import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { lead_id } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: lead, error } = await supabase
      .from("landing_page_leads")
      .select("*")
      .eq("id", lead_id)
      .single();

    if (error || !lead) {
      throw new Error(`Lead not found: ${lead_id}`);
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.warn("RESEND_API_KEY not set — skipping notification");
      return new Response(JSON.stringify({ skipped: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const source = lead.utm_source || "direct";
    const campaign = lead.utm_campaign || "-";
    const lostRevenue = Number(lead.lost_revenue_per_month).toLocaleString("en-US");

    const emailText = `
New lead from /missed-revenue:

Name:    ${lead.name}
Company: ${lead.company}
Email:   ${lead.email}
Phone:   ${lead.phone}

Their calculator results:
  Missed calls/mo:  ${lead.missed_calls_per_month}
  Lost jobs/mo:     ${lead.lost_jobs_per_month}
  Lost revenue/mo:  $${lostRevenue}

Source: ${source} / ${campaign}

Lead in dashboard: https://app.reliantsupport.net/leads/${lead.id}
    `.trim();

    const subject = `🔥 New warm lead: ${lead.company} ($${lostRevenue}/mo at risk)`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Reliant Support <noreply@reliantsupport.net>",
        to: ["greg@reliantsupport.net"],
        subject,
        text: emailText,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Resend error: ${err}`);
    }

    // TODO: Add Samantha's email or SMS notification here when she's onboarded

    return new Response(JSON.stringify({ sent: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("notify-new-lead error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
