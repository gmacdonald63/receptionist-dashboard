/**
 * notify-new-lead
 *
 * Entry point called fire-and-forget from the landing page after a lead is inserted.
 * Delegates to send-audit-pdf, which handles PDF generation, prospect email, and
 * Greg's internal notification in one call.
 *
 * Kept as a thin wrapper so the calling URL in MissedRevenuePage.jsx doesn't need
 * to change, and so future webhook sources (HubSpot, Zapier, etc.) can call this
 * same endpoint without knowing about the PDF internals.
 */

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
    const body = await req.json();
    const lead_id: string = body.lead_id;

    if (!lead_id) {
      return new Response(JSON.stringify({ error: "lead_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Delegate to send-audit-pdf — fire and don't await the result
    // (the caller already fire-and-forgets this function, so we can
    //  await here to get proper error logging without blocking the user)
    const res = await fetch(`${supabaseUrl}/functions/v1/send-audit-pdf`, {
      method: "POST",
      headers: {
        apikey:        anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ lead_id }),
    });

    const result = await res.json();
    console.log("send-audit-pdf result:", JSON.stringify(result));

    return new Response(JSON.stringify({ forwarded: true, result }), {
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
