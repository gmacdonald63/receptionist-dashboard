import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Commission calculation (mirrors src/utils/commissions.js) ──────────────

const PLAN_PRICES: Record<string, number> = { standard: 495, pro: 695 };
const ANNUAL_BONUS = 200;

function _formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function _addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

interface DealForCommission {
  id: string;
  rep_id: number;
  plan: string;
  billing_cycle: string;
}

function calculateCommissions(
  deal: DealForCommission,
  commissionOption: number,
  baseDate: Date
): Array<Record<string, unknown>> {
  const monthlyPrice = PLAN_PRICES[deal.plan];
  if (!monthlyPrice) throw new Error(`Unknown plan: ${deal.plan}`);

  const isAnnual = deal.billing_cycle === "annual";

  if (commissionOption === 1) {
    return [{
      deal_id: deal.id,
      rep_id: deal.rep_id,
      type: "upfront",
      month_number: null,
      amount: monthlyPrice + (isAnnual ? ANNUAL_BONUS : 0),
      status: "due",
      due_date: _formatDate(baseDate),
    }];
  }

  if (commissionOption === 2) {
    const upfrontAmount = (monthlyPrice * 0.5) + (isAnnual ? ANNUAL_BONUS : 0);
    const residualAmount = monthlyPrice * 0.1;

    const records: Array<Record<string, unknown>> = [{
      deal_id: deal.id,
      rep_id: deal.rep_id,
      type: "upfront",
      month_number: null,
      amount: upfrontAmount,
      status: "due",
      due_date: _formatDate(baseDate),
    }];

    for (let month = 1; month <= 12; month++) {
      records.push({
        deal_id: deal.id,
        rep_id: deal.rep_id,
        type: "residual",
        month_number: month,
        amount: residualAmount,
        status: month === 1 ? "due" : "pending",
        due_date: _formatDate(_addMonths(baseDate, month - 1)),
      });
    }

    return records;
  }

  throw new Error(`Unknown commission option: ${commissionOption}`);
}

// ── Main handler ──────────────────────────────────────────────────────────

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

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

        // ── Setup fee payment (one-time, from onboarding form) ────
        if (session.mode === "payment" && session.metadata?.type === "setup_fee") {
          const dealId = session.metadata?.deal_id;
          if (!dealId) {
            console.warn("setup_fee checkout completed but no deal_id in metadata");
            break;
          }

          // Capture Stripe payment data only — status update and notifications
          // are handled by save-onboarding-data after the client submits the form
          const { error: dealError } = await supabase
            .from("deals")
            .update({
              stripe_setup_payment_id: session.payment_intent as string,
              stripe_customer_id: session.customer as string,
            })
            .eq("id", dealId);

          if (dealError) {
            console.error(`Failed to update deal ${dealId}:`, dealError);
            break;
          }

          console.log(`Setup fee paid for deal ${dealId} — Stripe IDs captured`);

          break;
        }

        // ── Subscription checkout (existing behavior) ─────────────
        if (session.mode === "subscription" && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription as string
          );
          const clientId = session.metadata?.client_id;
          const priceId = subscription.items?.data?.[0]?.price?.id || null;
          if (clientId) {
            const { error: subUpdateError } = await supabase
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
            if (subUpdateError) {
              console.error(`Failed to update client ${clientId} subscription:`, subUpdateError);
            } else {
              console.log(`Client ${clientId} subscription activated: ${subscription.id} (price: ${priceId})`);
            }
          }
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const priceId = subscription.items?.data?.[0]?.price?.id || null;

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
          console.log(`Client ${client.id} subscription updated: status=${subscription.status}`);
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const priceId = subscription.items?.data?.[0]?.price?.id || null;

        // Update client's subscription status (existing behavior)
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
          console.log(`Client ${client.id} subscription deleted: status=${subscription.status}`);
        }

        // ── Deal cancellation + clawback ─────────────────────────
        // Try to find an active deal linked to this Stripe customer
        const { data: deal } = await supabase
          .from("deals")
          .select("id, clawback_safe")
          .eq("stripe_customer_id", customerId)
          .eq("status", "active")
          .maybeSingle();

        if (deal) {
          await supabase
            .from("deals")
            .update({ status: "cancelled" })
            .eq("id", deal.id);

          if (!deal.clawback_safe) {
            // Clawback: void all unpaid commissions for this deal
            const { error: voidErr } = await supabase
              .from("commissions")
              .update({ status: "voided" })
              .eq("deal_id", deal.id)
              .in("status", ["due", "pending"]);

            if (voidErr) {
              console.error(`Failed to void commissions for deal ${deal.id}:`, voidErr);
            } else {
              console.log(`Deal ${deal.id} cancelled — commissions voided (clawback applied)`);
            }
          } else {
            console.log(`Deal ${deal.id} cancelled — clawback-safe, commissions preserved`);
          }

          // HubSpot sync → cancelled = closedlost
          await fetch(`${supabaseUrl}/functions/v1/hubspot-sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deal_id: deal.id, action: "update" }),
          }).catch(e => console.error("hubspot-sync call failed:", e));
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;

        // Only process subscription invoices (not one-time setup fees)
        if (!invoice.subscription) {
          console.log(`invoice.paid: no subscription — skipping`);
          break;
        }

        const customerId = invoice.customer as string;
        const subscriptionId = invoice.subscription as string;

        // ── Find the deal for this subscription ──────────────────
        // Method 1: direct match by stripe_customer_id on deals (from setup fee payment)
        let { data: deal } = await supabase
          .from("deals")
          .select("id, rep_id, plan, billing_cycle, status, clawback_safe")
          .eq("stripe_customer_id", customerId)
          .in("status", ["setup_in_progress", "active"])
          .maybeSingle();

        // Method 2: match via clients.stripe_customer_id → deals.supabase_client_id
        if (!deal) {
          const { data: linkedClient } = await supabase
            .from("clients")
            .select("id")
            .eq("stripe_customer_id", customerId)
            .maybeSingle();

          if (linkedClient) {
            const { data: dealByLink } = await supabase
              .from("deals")
              .select("id, rep_id, plan, billing_cycle, status, clawback_safe")
              .eq("supabase_client_id", linkedClient.id)
              .in("status", ["setup_in_progress", "active"])
              .maybeSingle();
            if (dealByLink) deal = dealByLink;
          }
        }

        if (!deal) {
          console.log(`invoice.paid: no deal found for customer ${customerId} — regular client invoice`);
          break;
        }

        if (deal.status === "setup_in_progress") {
          // ── First subscription payment: activate the deal ─────
          const now = new Date();
          const isAnnual = deal.billing_cycle === "annual";

          // Fetch rep's commission_option
          const { data: rep } = await supabase
            .from("clients")
            .select("commission_option")
            .eq("id", deal.rep_id)
            .single();

          const commissionOption = rep?.commission_option ?? 1;

          // Activate the deal
          await supabase
            .from("deals")
            .update({
              status: "active",
              stripe_subscription_id: subscriptionId,
              // Annual plans are immediately clawback-safe (full year paid up front)
              clawback_safe: isAnnual,
            })
            .eq("id", deal.id);

          // Calculate and insert commission records
          const commissions = calculateCommissions(
            { id: deal.id, rep_id: deal.rep_id, plan: deal.plan, billing_cycle: deal.billing_cycle },
            commissionOption,
            now
          );

          if (commissions.length > 0) {
            const { error: commErr } = await supabase.from("commissions").insert(commissions);
            if (commErr) {
              console.error(`Failed to insert commissions for deal ${deal.id}:`, commErr);
            }
          }

          console.log(`Deal ${deal.id} activated — ${commissions.length} commission records created (option ${commissionOption})`);

          // HubSpot sync → active = closedwon
          await fetch(`${supabaseUrl}/functions/v1/hubspot-sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deal_id: deal.id, action: "update" }),
          }).catch(e => console.error("hubspot-sync call failed:", e));

          // Notifications for Greg and rep
          await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ template: "client_active_greg", deal_id: deal.id }),
          }).catch(e => console.error("send-notification (greg active) failed:", e));

          await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ template: "client_active_rep", deal_id: deal.id }),
          }).catch(e => console.error("send-notification (rep active) failed:", e));

        } else if (deal.status === "active") {
          // ── Renewal payment: advance residuals + set clawback-safe ──

          // Second payment makes monthly deals clawback-safe
          if (!deal.clawback_safe) {
            await supabase
              .from("deals")
              .update({ clawback_safe: true })
              .eq("id", deal.id);
            console.log(`Deal ${deal.id} is now clawback-safe (2nd payment received)`);
          }

          // Advance the next pending residual to 'due'
          const { data: nextResidual } = await supabase
            .from("commissions")
            .select("id, month_number")
            .eq("deal_id", deal.id)
            .eq("type", "residual")
            .eq("status", "pending")
            .order("month_number", { ascending: true })
            .limit(1)
            .maybeSingle();

          if (nextResidual) {
            await supabase
              .from("commissions")
              .update({
                status: "due",
                due_date: new Date().toISOString().split("T")[0],
              })
              .eq("id", nextResidual.id);

            console.log(`Deal ${deal.id} residual month ${nextResidual.month_number} is now due`);

            // Notify Greg that a residual commission is due
            await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ template: "residual_due_greg", deal_id: deal.id }),
            }).catch(e => console.error("send-notification (residual) failed:", e));
          }
        }
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
