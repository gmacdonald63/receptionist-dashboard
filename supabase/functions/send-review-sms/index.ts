// supabase/functions/send-review-sms/index.ts
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
    const { appointment_id, source } = await req.json();
    if (!appointment_id)
      return new Response(JSON.stringify({ error: "missing appointment_id" }), { status: 400, headers: cors });

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Validate caller is authenticated
    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await sb.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
    }

    // Fetch appointment
    const { data: apt } = await sb.from("appointments")
      .select("caller_name, caller_phone, caller_number, client_id, review_sms_sent_at, status")
      .eq("id", appointment_id).single();
    if (!apt) return new Response(JSON.stringify({ error: "appointment not found" }), { status: 404, headers: cors });

    // Fetch client settings
    const { data: client } = await sb.from("clients")
      .select("telnyx_api_key, telnyx_from_number, google_review_url, review_request_mode")
      .eq("id", apt.client_id).single();
    if (!client) return new Response(JSON.stringify({ error: "client not found" }), { status: 404, headers: cors });

    // If called from auto-trigger, only proceed when mode is 'auto'
    if (source === "auto" && client.review_request_mode !== "auto") {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "mode_is_manual" }), { headers: cors });
    }

    // Skip silently if no review URL configured
    if (!client.google_review_url) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "no_review_url" }), { headers: cors });
    }

    // Don't double-send
    if (apt.review_sms_sent_at) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "already_sent" }), { headers: cors });
    }

    const phone = apt.caller_phone || apt.caller_number;
    if (!phone) {
      return new Response(JSON.stringify({ error: "no phone number on appointment" }), { status: 422, headers: cors });
    }

    if (!client.telnyx_api_key || !client.telnyx_from_number) {
      return new Response(JSON.stringify({ error: "SMS not configured for this client" }), { status: 422, headers: cors });
    }

    const customerName = apt.caller_name?.split(" ")[0] || "there";
    const smsBody = `Hi ${customerName}, thank you for choosing us! We'd love to hear your feedback — please leave us a review: ${client.google_review_url}`;

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

    if (!smsRes.ok) {
      const smsErr = await smsRes.json().catch(() => ({}));
      console.error("Review SMS send failed:", smsErr);
      return new Response(JSON.stringify({ error: smsErr.error || "SMS send failed" }), { status: 500, headers: cors });
    }

    // Stamp the appointment so we don't double-send
    await sb.from("appointments")
      .update({ review_sms_sent_at: new Date().toISOString() })
      .eq("id", appointment_id);

    return new Response(JSON.stringify({ ok: true }), { headers: cors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: cors });
  }
});
