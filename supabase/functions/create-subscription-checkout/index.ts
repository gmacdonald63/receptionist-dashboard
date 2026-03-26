// supabase/functions/create-subscription-checkout/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PRICE_IDS: Record<string, Record<string, string>> = {
  standard: {
    monthly: "price_1TFLt6J9Bes3rv7O0fWvfB3c",
    annual: Deno.env.get("STRIPE_PRICE_STANDARD_ANNUAL") ?? "",
  },
  pro: {
    monthly: "price_1TFLwtJ9Bes3rv7ObtuStIhj",
    annual: Deno.env.get("STRIPE_PRICE_PRO_ANNUAL") ?? "",
  },
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

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Look up client ────────────────────────────────────────
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id, email, company_name, stripe_customer_id")
      .eq("activation_token", activation_token)
      .single();

    if (clientError || !client) {
      return new Response(JSON.stringify({ error: "Invalid activation link." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!client.stripe_customer_id) {
      return new Response(JSON.stringify({ error: "Setup fee not yet processed. Contact support." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Get plan from associated deal ─────────────────────────
    const { data: deal, error: dealError } = await supabase
      .from("deals")
      .select("plan, billing_cycle")
      .eq("supabase_client_id", client.id)
      .single();

    if (dealError || !deal) {
      return new Response(JSON.stringify({ error: "Account configuration incomplete. Contact support." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const priceId = PRICE_IDS[deal.plan]?.[deal.billing_cycle];
    if (!priceId) {
      return new Response(JSON.stringify({ error: `No price configured for plan ${deal.plan}/${deal.billing_cycle}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Create Stripe subscription checkout ───────────────────
    // IMPORTANT: use clients.stripe_customer_id (same Stripe customer as setup fee)
    // so that invoice.paid webhook can find the deal for commission calculation.
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: client.stripe_customer_id,
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        client_id: client.id,
        type: "subscription",
      },
      success_url: `https://app.reliantsupport.net/?activate=${activation_token}&paid=true`,
      cancel_url: `https://app.reliantsupport.net/?activate=${activation_token}`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("create-subscription-checkout error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
