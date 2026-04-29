// supabase/functions/send-estimate/index.ts
// Authenticated. Generates a portal token and sends the URL via SMS directly via Telnyx.
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

    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await sb.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
    }

    const { data: estimate } = await sb.from("estimates")
      .select("client_id, title")
      .eq("id", estimate_id)
      .single();
    if (!estimate)
      return new Response(JSON.stringify({ error: "estimate not found" }), { status: 404, headers: cors });

    const { data: client } = await sb.from("clients")
      .select("telnyx_from_number, estimate_validity_days, company_name")
      .eq("id", estimate.client_id)
      .single();

    // Revoke existing tokens for this estimate
    await sb.from("estimate_tokens")
      .update({ revoked: true })
      .eq("estimate_id", estimate_id)
      .eq("revoked", false);

    const validityDays = client?.estimate_validity_days ?? 30;
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

    // Call Telnyx directly — no intermediary function
    let smsSent = false;
    let smsError: string | null = null;
    const telnyxApiKey = Deno.env.get("TELNYX_API_KEY");

    if (client?.telnyx_from_number && telnyxApiKey) {
      const greeting = customer_name ? `Hi ${customer_name.split(" ")[0]}, ` : "";
      const smsBody =
        `${greeting}your estimate from ${client.company_name || "us"} is ready. ` +
        `View and approve it here: ${portalUrl}`;

      try {
        const smsRes = await fetch("https://api.telnyx.com/v2/messages", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${telnyxApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: client.telnyx_from_number,
            to: phone,
            text: smsBody,
          }),
        });
        const smsResult = await smsRes.json();
        if (smsRes.ok) {
          smsSent = true;
          console.log("✅ SMS sent:", smsResult.data?.id);
        } else {
          smsError = smsResult.errors?.[0]?.detail || `Telnyx error ${smsRes.status}`;
          console.error("❌ Telnyx error:", smsError);
        }
      } catch (smsErr) {
        smsError = smsErr instanceof Error ? smsErr.message : String(smsErr);
        console.error("❌ SMS fetch failed:", smsError);
      }
    } else if (!client?.telnyx_from_number) {
      smsError = "SMS from-number not configured for this client.";
    } else {
      smsError = "TELNYX_API_KEY secret not configured.";
    }

    // Update estimate status to 'sent' regardless of SMS result
    await sb.from("estimates")
      .update({ status: "sent" })
      .eq("id", estimate_id);

    return new Response(JSON.stringify({
      ok: true,
      sms_sent: smsSent,
      sms_error: smsError,
      token: tokenRow.token,
      portal_url: portalUrl,
    }), { headers: cors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌ send-estimate error:", message);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: cors });
  }
});
