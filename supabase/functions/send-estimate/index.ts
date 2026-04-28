// supabase/functions/send-estimate/index.ts
// Authenticated. Generates a portal token and sends the URL via SMS.
// Reuses the send-sms Edge Function (same pattern as generate-tracking-token).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
  }

  try {
    const { estimate_id, phone, customer_name } = await req.json();
    if (!estimate_id || !phone)
      return new Response(JSON.stringify({ error: "missing estimate_id or phone" }), { status: 400, headers: cors });

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate caller
    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await sb.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
    }

    // Fetch estimate to get client_id
    const { data: estimate } = await sb.from("estimates")
      .select("client_id, title")
      .eq("id", estimate_id)
      .single();
    if (!estimate)
      return new Response(JSON.stringify({ error: "estimate not found" }), { status: 404, headers: cors });

    // Fetch Telnyx credentials and validity from the client row
    const { data: client } = await sb.from("clients")
      .select("telnyx_api_key, telnyx_from_number, estimate_validity_days, business_name")
      .eq("id", estimate.client_id)
      .single();

    if (!client?.telnyx_api_key || !client?.telnyx_from_number)
      return new Response(
        JSON.stringify({ error: "SMS not configured for this client — set telnyx_api_key and telnyx_from_number" }),
        { status: 422, headers: cors }
      );

    // Revoke existing tokens for this estimate
    await sb.from("estimate_tokens")
      .update({ revoked: true })
      .eq("estimate_id", estimate_id)
      .eq("revoked", false);

    const validityDays = client.estimate_validity_days ?? 30;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + validityDays);

    const { data: tokenRow, error: insertError } = await sb.from("estimate_tokens")
      .insert({ estimate_id, client_id: estimate.client_id, expires_at: expiresAt.toISOString() })
      .select("token")
      .single();

    if (insertError || !tokenRow) {
      console.error("❌ send-estimate: token insert failed:", insertError?.message);
      return new Response(JSON.stringify({ error: "Failed to create token" }), { status: 500, headers: cors });
    }

    const portalUrl = `https://app.reliantsupport.net/?estimate=${tokenRow.token}`;
    const greeting = customer_name ? `Hi ${customer_name.split(" ")[0]}, ` : "";
    const smsBody =
      `${greeting}your estimate from ${client.business_name || "us"} is ready. ` +
      `View and approve it here: ${portalUrl}`;

    // Send SMS via send-sms function
    const smsRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "apikey": Deno.env.get("SUPABASE_ANON_KEY")!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: phone,
        body: smsBody,
        telnyx_api_key: client.telnyx_api_key,
        telnyx_from_number: client.telnyx_from_number,
      }),
    });

    const smsSent = smsRes.ok;
    if (!smsRes.ok) {
      const smsErr = await smsRes.json().catch(() => ({}));
      console.error("❌ send-estimate: SMS failed:", smsErr);
    }

    // Update estimate status to 'sent'
    await sb.from("estimates")
      .update({ status: "sent" })
      .eq("id", estimate_id);

    return new Response(JSON.stringify({
      ok: true,
      sms_sent: smsSent,
      token: tokenRow.token,
      portal_url: portalUrl,
    }), { headers: cors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌ send-estimate error:", message);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: cors });
  }
});
