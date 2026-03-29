// supabase/functions/send-sms/index.ts
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
  }

  try {
    const { to, body, twilio_account_sid, twilio_auth_token, twilio_from_number } = await req.json();
    if (!to || !body || !twilio_account_sid || !twilio_auth_token || !twilio_from_number)
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: cors });

    if (!/^AC[a-f0-9]{32}$/.test(twilio_account_sid))
      return new Response(JSON.stringify({ error: "Invalid account SID format" }), { status: 400, headers: cors });

    const formData = new URLSearchParams();
    formData.append("To", to);
    formData.append("From", twilio_from_number);
    formData.append("Body", body);

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilio_account_sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${btoa(`${twilio_account_sid}:${twilio_auth_token}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      }
    );
    const result = await res.json();
    if (!res.ok) return new Response(JSON.stringify({ error: result.message, code: result.code }), { status: res.status, headers: cors });
    return new Response(JSON.stringify({ ok: true, sid: result.sid }), { headers: cors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: cors });
  }
});
