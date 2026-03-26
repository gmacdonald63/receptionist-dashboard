// supabase/functions/save-onboarding-data/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token, onboarding_data } = await req.json();

    if (!token || !onboarding_data) {
      return new Response(JSON.stringify({ error: "Missing token or onboarding_data" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Look up deal ─────────────────────────────────────────
    const { data: deal, error } = await supabase
      .from("deals")
      .select("id, status, client_email, company_name, client_name")
      .eq("onboarding_token", token)
      .single();

    if (error || !deal) {
      return new Response(JSON.stringify({ error: "Invalid onboarding link." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Idempotency guard ────────────────────────────────────
    if (deal.status !== "onboarding_sent") {
      return new Response(JSON.stringify({ error: "already_submitted" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Save form data + update status ───────────────────────
    const { error: updateError } = await supabase
      .from("deals")
      .update({
        onboarding_data,
        status: "setup_in_progress",
      })
      .eq("id", deal.id);

    if (updateError) {
      console.error("Failed to save onboarding data:", updateError);
      throw new Error("Failed to save onboarding data");
    }

    // ── Dispatch notifications (non-blocking) ────────────────
    const notifyUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification`;
    const notifyHeaders = {
      "Content-Type": "application/json",
      "apikey": Deno.env.get("SUPABASE_ANON_KEY") || "",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
    };

    fetch(notifyUrl, {
      method: "POST",
      headers: notifyHeaders,
      body: JSON.stringify({ template: "setup_fee_paid_greg", deal_id: deal.id }),
    }).catch(e => console.error("Greg notification failed:", e));

    fetch(notifyUrl, {
      method: "POST",
      headers: notifyHeaders,
      body: JSON.stringify({ template: "setup_fee_paid_rep", deal_id: deal.id }),
    }).catch(e => console.error("Rep notification failed:", e));

    return new Response(JSON.stringify({ saved: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("save-onboarding-data error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
