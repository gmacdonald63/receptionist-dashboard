// supabase/functions/generate-tracking-token/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const APP_URL = "https://app.reliantsupport.net";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { appointment_id, technician_id } = await req.json();
    if (!appointment_id || !technician_id)
      return new Response(JSON.stringify({ error: "missing appointment_id or technician_id" }), { status: 400, headers: cors });

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: apt } = await sb.from("appointments")
      .select("caller_name, caller_phone, end_time, service_type, client_id, date")
      .eq("id", appointment_id).single();
    if (!apt) return new Response(JSON.stringify({ error: "appointment not found" }), { status: 404, headers: cors });

    const { data: client } = await sb.from("clients")
      .select("twilio_account_sid, twilio_auth_token, twilio_from_number")
      .eq("id", apt.client_id).single();

    const { data: tech } = await sb.from("technicians").select("name").eq("id", technician_id).single();
    const techFirst = tech?.name?.split(' ')[0] || 'Your technician';

    // Revoke existing tokens for this appointment
    const { error: revokeError } = await sb.from("tracking_tokens").update({ revoked: true })
      .eq("appointment_id", appointment_id).eq("revoked", false);
    if (revokeError) console.error("Failed to revoke tokens:", revokeError.message);

    // expires_at = appointment end_time + 2 hours (fallback: now + 4h)
    let expiresAt: string;
    if (apt.end_time && apt.date) {
      const d = new Date(`${apt.date}T${apt.end_time}`);
      d.setHours(d.getHours() + 2);
      expiresAt = d.toISOString();
    } else {
      const d = new Date(); d.setHours(d.getHours() + 4);
      expiresAt = d.toISOString();
    }

    const { data: tokenRow, error: insertError } = await sb.from("tracking_tokens")
      .insert({ appointment_id, technician_id, client_id: apt.client_id, expires_at: expiresAt })
      .select("token").single();

    if (insertError || !tokenRow)
      return new Response(JSON.stringify({ error: "Failed to create tracking token" }), { status: 500, headers: cors });

    const trackingUrl = `${APP_URL}/?track=${tokenRow.token}`;

    // Send SMS if Twilio configured and customer has a phone
    let smsSent = false;
    if (client?.twilio_account_sid && client?.twilio_from_number && apt.caller_phone) {
      const smsRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "apikey": Deno.env.get("SUPABASE_ANON_KEY")!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: apt.caller_phone,
          body: `Hi ${apt.caller_name || 'there'}, ${techFirst} is on the way! Track their location: ${trackingUrl}`,
          twilio_account_sid: client.twilio_account_sid,
          twilio_auth_token: client.twilio_auth_token,
          twilio_from_number: client.twilio_from_number,
        }),
      });
      smsSent = smsRes.ok;
      if (!smsRes.ok) {
        const smsErr = await smsRes.json().catch(() => ({}));
        console.error("SMS send failed:", smsErr);
      }
    }

    return new Response(JSON.stringify({ ok: true, tracking_url: trackingUrl, sms_sent: smsSent }), { headers: cors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: cors });
  }
});
