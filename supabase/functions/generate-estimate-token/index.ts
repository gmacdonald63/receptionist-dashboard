// supabase/functions/generate-estimate-token/index.ts
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

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
  }

  try {
    const { estimate_id } = await req.json();
    if (!estimate_id)
      return new Response(JSON.stringify({ error: "missing estimate_id" }), { status: 400, headers: cors });

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate caller is authenticated
    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await sb.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: cors });
    }

    // Fetch estimate to get client_id and confirm it exists
    const { data: estimate } = await sb.from("estimates")
      .select("id, client_id, status")
      .eq("id", estimate_id)
      .single();
    if (!estimate)
      return new Response(JSON.stringify({ error: "estimate not found" }), { status: 404, headers: cors });

    // Fetch client settings for validity period
    const { data: client } = await sb.from("clients")
      .select("estimate_validity_days")
      .eq("id", estimate.client_id)
      .single();
    const validityDays = client?.estimate_validity_days ?? 30;

    // Revoke any existing tokens for this estimate (one active token at a time)
    await sb.from("estimate_tokens")
      .update({ revoked: true })
      .eq("estimate_id", estimate_id)
      .eq("revoked", false);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + validityDays);

    const { data: tokenRow, error: insertError } = await sb.from("estimate_tokens")
      .insert({
        estimate_id,
        client_id: estimate.client_id,
        expires_at: expiresAt.toISOString(),
      })
      .select("token")
      .single();

    if (insertError || !tokenRow) {
      console.error("❌ generate-estimate-token: insert failed:", insertError?.message);
      return new Response(JSON.stringify({ error: "Failed to create token" }), { status: 500, headers: cors });
    }

    const portalUrl = `${APP_URL}/?estimate=${tokenRow.token}`;

    return new Response(
      JSON.stringify({ ok: true, token: tokenRow.token, portal_url: portalUrl }),
      { headers: cors }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌ generate-estimate-token error:", message);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: cors });
  }
});
