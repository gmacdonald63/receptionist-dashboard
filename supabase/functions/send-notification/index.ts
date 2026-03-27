// supabase/functions/send-notification/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Template =
  | "onboarding_link_client"
  | "activation_invite"
  | "setup_fee_paid_greg"
  | "setup_fee_paid_rep"
  | "client_active_greg"
  | "client_active_rep"
  | "residual_due_greg"
  | "commission_paid_rep";

interface NotificationRequest {
  template: Template;
  deal_id?: string;
  // Direct payload for client-targeted templates (e.g. activation_invite):
  to?: string;
  client_name?: string;
  company_name?: string;
  activation_token?: string;
}

async function sendEmail(apiKey: string, to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Reliant Support <noreply@reliantsupport.net>",
      to,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend API error: ${err}`);
  }
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.warn("RESEND_API_KEY not configured — skipping notification");
      return new Response(JSON.stringify({ skipped: true, reason: "RESEND_API_KEY not set" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ownerEmail = Deno.env.get("OWNER_EMAIL") || "gmacdonald63@gmail.com";

    const body: NotificationRequest = await req.json();
    const { template, deal_id } = body;

    if (template === 'activation_invite') {
      const { to, client_name, company_name, activation_token } = body;
      if (!to || !client_name || !company_name || !activation_token) {
        return new Response(JSON.stringify({ error: "Missing activation_invite fields" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const activationUrl = `https://app.reliantsupport.net/?activate=${activation_token}`;
      const subject = `You're all set — activate your Reliant Support account`;
      const html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; background: #111827; color: #f9fafb;">
          <h1 style="color: #f9fafb; font-size: 24px; margin-bottom: 16px;">
            You're all set, ${client_name}!
          </h1>
          <p style="color: #9ca3af; margin-bottom: 8px;">
            Great news — your AI receptionist account for <strong style="color: #f9fafb;">${company_name}</strong>
            is fully configured and ready to go.
          </p>
          <p style="color: #9ca3af; margin-bottom: 32px;">
            Follow the link below to set up your subscription and create your password to access your dashboard:
          </p>
          <a href="${activationUrl}"
             style="display: inline-block; background: #2563eb; color: #ffffff; padding: 14px 28px;
                    border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
            Proceed
          </a>
          <p style="color: #6b7280; margin-top: 40px; font-size: 14px;">
            — The Reliant Support Team<br/>
            If you have any questions, contact us at
            <a href="mailto:support@reliantsupport.net" style="color: #60a5fa;">support@reliantsupport.net</a>
          </p>
        </div>
      `;
      await sendEmail(resendKey, to, subject, html);
      return new Response(JSON.stringify({ sent: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load deal + rep data
    const { data: deal, error } = await supabase
      .from("deals")
      .select(`
        id, client_name, client_email, company_name, plan, billing_cycle, status, onboarding_data,
        rep:rep_id ( id, email, company_name )
      `)
      .eq("id", deal_id)
      .single();

    if (error || !deal) {
      throw new Error(`Deal not found: ${deal_id}`);
    }

    const repName = deal.rep?.company_name || deal.rep?.email || "Sales Rep";
    const planLabel = deal.plan === "pro" ? "Pro" : "Standard";
    const cycleLabel = deal.billing_cycle === "annual" ? "Annual" : "Monthly";

    const APP_URL = "https://app.reliantsupport.net";

    switch (template) {
      case "onboarding_link_client": {
        const onboardingUrl = `${APP_URL}/onboard?token=${deal.id}`;
        // Fetch the actual onboarding token from the deal
        const { data: dealWithToken } = await supabase
          .from("deals")
          .select("onboarding_token")
          .eq("id", deal_id)
          .single();
        const url = `${APP_URL}/onboard?token=${dealWithToken?.onboarding_token || deal.id}`;
        await sendEmail(
          resendKey,
          deal.client_email,
          `Your Reliant Support setup link — ${deal.company_name}`,
          `<h2>Welcome to Reliant Support!</h2>
           <p>Hi ${deal.client_name},</p>
           <p>Your sales representative has set up an account for <strong>${deal.company_name}</strong>.</p>
           <p>Please click the link below to complete your setup and pay the one-time setup fee of <strong>$395</strong>:</p>
           <p><a href="${url}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Begin Your Setup</a></p>
           <p>Or copy this link into your browser:<br/>${url}</p>
           <p>If you have any questions, contact us at <a href="mailto:support@reliantsupport.net">support@reliantsupport.net</a></p>
           <br/><p>— The Reliant Support Team</p>`
        );
        break;
      }

      case "setup_fee_paid_greg": {
        const od = deal.onboarding_data || {};
        await sendEmail(
          resendKey,
          ownerEmail,
          `New client setup: ${deal.client_name}`,
          `<h2>New Client Setup Request</h2>
           <p><strong>Client:</strong> ${deal.client_name} (${deal.client_email})</p>
           <p><strong>Company:</strong> ${deal.company_name}</p>
           <p><strong>Plan:</strong> ${planLabel} / ${cycleLabel}</p>
           <p><strong>Sales Rep:</strong> ${repName}</p>
           <hr/>
           <h3>Onboarding Details</h3>
           <p><strong>Address:</strong> ${od.address || "—"}, ${od.city || "—"}, ${od.province || "—"} ${od.postal_code || ""}</p>
           <p><strong>Services:</strong> ${od.services || "—"}</p>
           <p><strong>Special Instructions:</strong> ${od.special_instructions || "None"}</p>
           <p><strong>Hours:</strong></p>
           <pre>${JSON.stringify(od.hours || {}, null, 2)}</pre>`
        );
        break;
      }

      case "setup_fee_paid_rep": {
        await sendEmail(
          resendKey,
          deal.rep?.email,
          `Setup fee received for ${deal.client_name}`,
          `<h2>Setup Fee Received</h2>
           <p>${deal.client_name} at ${deal.company_name} has paid the $395 setup fee.</p>
           <p>Greg is now configuring their AI receptionist. You'll be notified when they go live.</p>`
        );
        break;
      }

      case "client_active_greg": {
        await sendEmail(
          resendKey,
          ownerEmail,
          `Client live + commission due: ${deal.client_name}`,
          `<h2>Client Is Live</h2>
           <p><strong>${deal.client_name}</strong> at ${deal.company_name} is now active on the ${planLabel} plan.</p>
           <p>Commission is due to <strong>${repName}</strong>. Log in to the admin panel to mark it paid.</p>`
        );
        break;
      }

      case "client_active_rep": {
        await sendEmail(
          resendKey,
          deal.rep?.email,
          `Your client ${deal.client_name} is live!`,
          `<h2>Great news!</h2>
           <p>${deal.client_name} at ${deal.company_name} is now active on Reliant Support (${planLabel} / ${cycleLabel}).</p>
           <p>Your commission has been recorded and will be paid shortly.</p>`
        );
        break;
      }

      case "residual_due_greg": {
        await sendEmail(
          resendKey,
          ownerEmail,
          `Monthly commission due: ${repName} for ${deal.client_name}`,
          `<h2>Monthly Residual Commission Due</h2>
           <p>A monthly residual commission is due to <strong>${repName}</strong> for client <strong>${deal.client_name}</strong>.</p>
           <p>Log in to the admin panel to review and mark it paid.</p>`
        );
        break;
      }

      case "commission_paid_rep": {
        await sendEmail(
          resendKey,
          deal.rep?.email,
          `Commission paid`,
          `<h2>Commission Paid</h2>
           <p>A commission for client <strong>${deal.client_name}</strong> has been marked as paid.</p>
           <p>Check your bank account for the transfer.</p>`
        );
        break;
      }

      default:
        throw new Error(`Unknown template: ${template}`);
    }

    return new Response(JSON.stringify({ sent: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-notification error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
