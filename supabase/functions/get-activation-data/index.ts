// supabase/functions/get-activation-data/index.ts
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
    const { activation_token } = await req.json();

    if (!activation_token) {
      return new Response(JSON.stringify({ error: "Missing activation_token" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Look up client by activation_token ───────────────────
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id, email, company_name")
      .eq("activation_token", activation_token)
      .single();

    if (clientError || !client) {
      return new Response(JSON.stringify({ error: "Invalid or expired activation link." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Join to deal for plan details ─────────────────────────
    const { data: deal, error: dealError } = await supabase
      .from("deals")
      .select("plan, billing_cycle")
      .eq("supabase_client_id", client.id)
      .single();

    if (dealError || !deal) {
      console.error("No deal found for client:", client.id, dealError);
      return new Response(JSON.stringify({ error: "Account configuration incomplete. Contact support." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Derive plan display info ──────────────────────────────
    const planMap: Record<string, { name: string; monthly_price: number }> = {
      standard: { name: "Standard Plan", monthly_price: 495 },
      pro: { name: "Pro Plan", monthly_price: 695 },
    };
    const planInfo = planMap[deal.plan] ?? { name: deal.plan, monthly_price: 0 };

    return new Response(JSON.stringify({
      company_name: client.company_name,
      email: client.email,
      plan_name: planInfo.name,
      monthly_price: planInfo.monthly_price,
      billing_cycle: deal.billing_cycle,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("get-activation-data error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
