// supabase/functions/get-estimate/index.ts
// Public endpoint — no JWT. Called by EstimateViewerPublic.jsx.
// Uses service-role key to read past RLS; token validation is the auth mechanism.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const JSON_CORS = { ...cors, "Content-Type": "application/json" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const token = new URL(req.url).searchParams.get("token");
  if (!token || !UUID_RE.test(token))
    return new Response(JSON.stringify({ error: "invalid token" }), { status: 400, headers: JSON_CORS });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate token
    const { data: tokenRow } = await sb.from("estimate_tokens")
      .select("estimate_id, client_id, expires_at, revoked")
      .eq("token", token)
      .single();

    if (!tokenRow || tokenRow.revoked || new Date(tokenRow.expires_at) < new Date())
      return new Response(JSON.stringify({ error: "invalid or expired token" }), { status: 403, headers: JSON_CORS });

    // Fetch estimate header
    const { data: estimate } = await sb.from("estimates")
      .select("id, status, title, notes, expires_at, approved_at, accepted_option_id, created_at")
      .eq("id", tokenRow.estimate_id)
      .single();
    if (!estimate)
      return new Response(JSON.stringify({ error: "estimate not found" }), { status: 404, headers: JSON_CORS });

    // Fetch options + line items in one query
    const { data: options } = await sb.from("estimate_options")
      .select(`
        id, label, sort_order, subtotal, tax_amount, total,
        estimate_line_items (
          id, name, description, unit_type, quantity, unit_price, taxable, sort_order
        )
      `)
      .eq("estimate_id", tokenRow.estimate_id)
      .order("sort_order");

    // Fetch client name for the portal header
    const { data: client } = await sb.from("clients")
      .select("business_name, estimate_legal_text")
      .eq("id", tokenRow.client_id)
      .single();

    // Mark as 'viewed' if currently 'sent' (fire-and-forget; don't block response)
    if (estimate.status === "sent") {
      sb.from("estimates")
        .update({ status: "viewed" })
        .eq("id", tokenRow.estimate_id)
        .then(({ error }) => {
          if (error) console.error("❌ get-estimate: status update failed:", error.message);
        });
    }

    return new Response(JSON.stringify({
      estimate: {
        ...estimate,
        // Return 'viewed' immediately so the portal shows the right state
        status: estimate.status === "sent" ? "viewed" : estimate.status,
      },
      options: options ?? [],
      client: {
        business_name: client?.business_name ?? "",
        legal_text: client?.estimate_legal_text ?? null,
      },
    }), { headers: JSON_CORS });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌ get-estimate error:", message);
    return new Response(JSON.stringify({ error: "internal server error" }), { status: 500, headers: JSON_CORS });
  }
});
