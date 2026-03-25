// supabase/functions/create-deal/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const APP_URL = "https://app.reliantsupport.net";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Authenticate: require a valid JWT ──────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const jwt = authHeader.replace("Bearer ", "");

    // Use service role for DB writes; verify JWT via auth API
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify JWT and get the authenticated user's ID
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Verify the user is a sales rep ────────────────────────
    const { data: rep, error: repError } = await supabase
      .from("clients")
      .select("id, is_sales_rep, commission_option")
      .eq("email", user.email)
      .single();

    if (repError || !rep) {
      return new Response(JSON.stringify({ error: "Client record not found" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!rep.is_sales_rep) {
      return new Response(JSON.stringify({ error: "Account is not a sales rep" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Parse and validate request body ───────────────────────
    const body = await req.json();
    const { client_name, client_email, client_phone, company_name, plan, billing_cycle } = body;

    if (!client_name || !client_email || !company_name || !plan || !billing_cycle) {
      return new Response(JSON.stringify({ error: "Missing required fields: client_name, client_email, company_name, plan, billing_cycle" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["standard", "pro"].includes(plan)) {
      return new Response(JSON.stringify({ error: "plan must be 'standard' or 'pro'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["monthly", "annual"].includes(billing_cycle)) {
      return new Response(JSON.stringify({ error: "billing_cycle must be 'monthly' or 'annual'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Create the deal record ─────────────────────────────────
    const { data: deal, error: insertError } = await supabase
      .from("deals")
      .insert({
        rep_id: rep.id,
        client_name,
        client_email,
        client_phone: client_phone || null,
        company_name,
        plan,
        billing_cycle,
        status: "onboarding_sent",
      })
      .select("id, onboarding_token")
      .single();

    if (insertError) {
      console.error("Deal insert error:", insertError);
      return new Response(JSON.stringify({ error: "Failed to create deal" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const onboardingUrl = `${APP_URL}/onboard?token=${deal.onboarding_token}`;

    console.log(`Deal created: ${deal.id} by rep ${rep.id}, token: ${deal.onboarding_token}`);

    return new Response(
      JSON.stringify({
        deal_id: deal.id,
        onboarding_url: onboardingUrl,
      }),
      {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("create-deal error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
