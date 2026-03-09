import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";

// Commission amounts by Stripe price ID (flat, one-time per signup)
const COMMISSION_MAP: Record<string, { amount: number; plan_type: string }> = {
  "price_1T7BFxJVgG4IIGoFcnMC98UN": { amount: 495, plan_type: "standard_monthly" },
  "price_1T7BLkJVgG4IIGoFRdPuSpS9": { amount: 695, plan_type: "pro_monthly" },
  // Annual price IDs — add here when created in Stripe
  // "price_ANNUAL_STANDARD": { amount: 695, plan_type: "standard_annual" },
  // "price_ANNUAL_PRO": { amount: 895, plan_type: "pro_annual" },
};

// Check if a newly-activated client matches a sales rep's lead, and auto-convert
async function tryAutoConvertLead(
  supabase: ReturnType<typeof createClient>,
  clientId: number,
  priceId: string | null
) {
  try {
    // Fetch client email
    const { data: client } = await supabase
      .from("clients")
      .select("id, email")
      .eq("id", clientId)
      .single();

    if (!client?.email) return;

    // Find an unconverted lead with matching email
    const { data: lead } = await supabase
      .from("leads")
      .select("id, sales_rep_id")
      .eq("email", client.email.toLowerCase())
      .is("converted_client_id", null)
      .in("stage", ["new", "contacted", "demo"])
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    if (!lead) return;

    // Determine commission amount
    const commission = priceId && COMMISSION_MAP[priceId]
      ? COMMISSION_MAP[priceId]
      : { amount: 495, plan_type: "unknown" };

    // Update lead to signed_up
    await supabase
      .from("leads")
      .update({
        stage: "signed_up",
        converted_client_id: client.id,
        converted_at: new Date().toISOString(),
      })
      .eq("id", lead.id);

    // Create commission record
    await supabase
      .from("commissions")
      .insert({
        sales_rep_id: lead.sales_rep_id,
        lead_id: lead.id,
        client_id: client.id,
        amount: commission.amount,
        plan_type: commission.plan_type,
        stripe_price_id: priceId,
        status: "pending",
      });

    console.log(
      `Auto-conversion: Lead ${lead.id} → Client ${client.id}, commission $${commission.amount} (${commission.plan_type})`
    );
  } catch (err) {
    // Log but don't fail the webhook — auto-conversion is best-effort
    console.error("Auto-conversion error:", err);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

    // Use service role for DB writes (webhook is server-to-server)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.text();
    let event: Stripe.Event;

    // Verify webhook signature if secret is configured
    if (webhookSecret) {
      const signature = req.headers.get("stripe-signature");
      if (!signature) {
        return new Response(JSON.stringify({ error: "Missing stripe-signature" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    } else {
      // No webhook secret configured yet — parse raw (test mode only)
      event = JSON.parse(body) as Stripe.Event;
    }

    console.log(`Stripe webhook received: ${event.type}`);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription as string
          );
          const clientId = session.metadata?.client_id;
          // Extract the price ID from the first subscription item
          const priceId = subscription.items?.data?.[0]?.price?.id || null;
          if (clientId) {
            await supabase
              .from("clients")
              .update({
                stripe_customer_id: session.customer as string,
                stripe_subscription_id: subscription.id,
                subscription_status: subscription.status,
                stripe_price_id: priceId,
                current_period_end: new Date(
                  subscription.current_period_end * 1000
                ).toISOString(),
              })
              .eq("id", parseInt(clientId));
            console.log(`Client ${clientId} subscription activated: ${subscription.id} (price: ${priceId})`);

            // Auto-convert matching lead and create commission
            await tryAutoConvertLead(supabase, parseInt(clientId), priceId);
          }
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        // Extract the price ID from the first subscription item
        const priceId = subscription.items?.data?.[0]?.price?.id || null;

        // Find client by stripe_customer_id
        const { data: client } = await supabase
          .from("clients")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (client) {
          await supabase
            .from("clients")
            .update({
              stripe_subscription_id: subscription.id,
              subscription_status: subscription.status,
              stripe_price_id: priceId,
              current_period_end: new Date(
                subscription.current_period_end * 1000
              ).toISOString(),
            })
            .eq("id", client.id);
          console.log(
            `Client ${client.id} subscription ${event.type}: status=${subscription.status}, price=${priceId}`
          );

          // Auto-convert if subscription just became active (e.g. trial → active)
          if (subscription.status === "active") {
            await tryAutoConvertLead(supabase, client.id, priceId);
          }
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        console.log(`Invoice paid for customer ${customerId}: ${invoice.id}`);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        const { data: client } = await supabase
          .from("clients")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (client) {
          await supabase
            .from("clients")
            .update({ subscription_status: "past_due" })
            .eq("id", client.id);
          console.log(`Client ${client.id} payment failed — marked past_due`);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Stripe webhook error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
