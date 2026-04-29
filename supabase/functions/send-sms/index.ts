// supabase/functions/send-sms/index.ts
// Internal utility called only by other Edge Functions.
// Auth: checks apikey header against SUPABASE_ANON_KEY (passed through by gateway untouched).
// TELNYX_API_KEY is read from env secret.
const corsOnly = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const cors = { ...corsOnly, "Content-Type": "application/json" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsOnly });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });

  // Verify internal caller via apikey header (anon key passed through by Supabase gateway unchanged)
  const apikey = req.headers.get("apikey");
  if (!apikey || apikey !== Deno.env.get("SUPABASE_ANON_KEY")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
  }

  try {
    const { to, body, telnyx_from_number } = await req.json();
    if (!to || !body || !telnyx_from_number)
      return new Response(JSON.stringify({ error: "Missing required fields: to, body, telnyx_from_number" }), { status: 400, headers: cors });

    const apiKey = Deno.env.get("TELNYX_API_KEY");
    if (!apiKey)
      return new Response(JSON.stringify({ error: "TELNYX_API_KEY secret not configured" }), { status: 500, headers: cors });

    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
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
