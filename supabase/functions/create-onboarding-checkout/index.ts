// supabase/functions/create-onboarding-checkout/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const APP_URL = "https://app.reliantsupport.net";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token } = await req.json();

    if (!token) {
      return new Response(JSON.stringify({ error: "Missing token" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Look up deal by token ────────────────────────────────
    const { data: deal, error } = await supabase
      .from("deals")
      .select("id, client_email, company_name, onboarding_token, status")
      .eq("onboarding_token", token)
      .single();

    if (error || !deal) {
      return new Response(JSON.stringify({ error: "Invalid onboarding link." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (deal.status !== "onboarding_sent") {
      return new Response(JSON.stringify({ error: "This onboarding has already been completed." }), {
        status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Create Stripe Checkout session ($395 one-time) ───────
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_creation: "always", // Ensures session.customer is set in the webhook
      line_items: [{
        price: "price_1TFNwcJ9Bes3rv7OPPxC0nHm",
        quantity: 1,
      }],
      metadata: {
        deal_id: deal.id,
        type: "setup_fee",
      },
      customer_email: deal.client_email,
      success_url: `${APP_URL}/onboard?token=${deal.onboarding_token}&success=true`,
      cancel_url: `${APP_URL}/onboard?token=${deal.onboarding_token}`,
    });

    console.log(`Checkout session created for deal ${deal.id}: ${session.id}`);

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("create-onboarding-checkout error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
