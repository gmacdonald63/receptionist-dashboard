// supabase/functions/approve-estimate/index.ts
// Public endpoint — no JWT. Called by EstimateViewerPublic on customer approval.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const { token, option_id } = await req.json();

    if (!token || !UUID_RE.test(token))
      return new Response(JSON.stringify({ error: "invalid token" }), { status: 400, headers: cors });
    if (!option_id || !UUID_RE.test(option_id))
      return new Response(JSON.stringify({ error: "invalid option_id" }), { status: 400, headers: cors });

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate token
    const { data: tokenRow } = await sb.from("estimate_tokens")
      .select("estimate_id, expires_at, revoked")
      .eq("token", token)
      .single();

    if (!tokenRow || tokenRow.revoked || new Date(tokenRow.expires_at) < new Date())
      return new Response(JSON.stringify({ error: "invalid or expired token" }), { status: 403, headers: cors });

    // Confirm option belongs to this estimate
    const { data: option } = await sb.from("estimate_options")
      .select("id, estimate_id")
      .eq("id", option_id)
      .eq("estimate_id", tokenRow.estimate_id)
      .single();
    if (!option)
      return new Response(JSON.stringify({ error: "option not found on this estimate" }), { status: 404, headers: cors });

    // Confirm estimate is still in an approvable state
    const { data: estimate } = await sb.from("estimates")
      .select("status")
      .eq("id", tokenRow.estimate_id)
      .single();
    if (!estimate)
      return new Response(JSON.stringify({ error: "estimate not found" }), { status: 404, headers: cors });
    if (!["draft", "sent", "viewed"].includes(estimate.status))
      return new Response(
        JSON.stringify({ error: `estimate cannot be approved from status '${estimate.status}'` }),
        { status: 409, headers: cors }
      );

    // Capture customer IP address for legal record
    const clientIp =
      req.headers.get("cf-connecting-ip") ??      // Cloudflare (Supabase edge)
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";

    const { error: updateError } = await sb.from("estimates")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by_ip: clientIp,
        accepted_option_id: option_id,
      })
      .eq("id", tokenRow.estimate_id);

    if (updateError) {
      console.error("❌ approve-estimate: update failed:", updateError.message);
      return new Response(JSON.stringify({ error: "Failed to record approval" }), { status: 500, headers: cors });
    }

    // Token is NOT revoked — customer can still open the link to see their confirmation.
    // The estimate status 'approved' drives the portal into read-only mode.

    return new Response(JSON.stringify({ ok: true }), { headers: cors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌ approve-estimate error:", message);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: cors });
  }
});
