// supabase/functions/send-sms/index.ts
const corsOnly = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const cors = { ...corsOnly, "Content-Type": "application/json" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsOnly });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
  }

  try {
    const { to, body, telnyx_api_key, telnyx_from_number } = await req.json();
    if (!to || !body || !telnyx_api_key || !telnyx_from_number)
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: cors });

    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${telnyx_api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: telnyx_from_number, to, text: body }),
    });

    const result = await res.json();
    if (!res.ok) return new Response(JSON.stringify({ error: result.errors?.[0]?.detail || "SMS failed" }), { status: res.status, headers: cors });
    return new Response(JSON.stringify({ ok: true, id: result.data?.id }), { headers: cors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: cors });
  }
});
