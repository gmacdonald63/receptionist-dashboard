// supabase/functions/send-sms/index.ts
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { to, body, twilio_account_sid, twilio_auth_token, twilio_from_number } = await req.json();
    if (!to || !body || !twilio_account_sid || !twilio_auth_token || !twilio_from_number)
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: cors });

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
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors });
  }
});
