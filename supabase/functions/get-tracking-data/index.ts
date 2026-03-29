// supabase/functions/get-tracking-data/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const token = new URL(req.url).searchParams.get("token");
  if (!token) return new Response(JSON.stringify({ error: "missing token" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(token))
    return new Response(JSON.stringify({ error: "invalid token" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: row } = await sb.from("tracking_tokens")
      .select("appointment_id, technician_id, expires_at, revoked").eq("token", token).single();

    if (!row || row.revoked || new Date(row.expires_at) < new Date())
      return new Response(JSON.stringify({ error: "invalid or expired token" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });

    const { data: apt } = await sb.from("appointments")
      .select("status, start_time, end_time, service_type").eq("id", row.appointment_id).single();
    if (!apt) return new Response(JSON.stringify({ error: "appointment not found" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });

    // Complete: return 200 with status only — no live location
    if (apt.status === "complete")
      return new Response(JSON.stringify({ status: "complete" }), { headers: { ...cors, "Content-Type": "application/json" } });

    const [{ data: loc }, { data: tech }] = await Promise.all([
      sb.from("tech_locations").select("lat, lng").eq("technician_id", row.technician_id).single(),
      sb.from("technicians").select("name, color").eq("id", row.technician_id).single(),
    ]);

    return new Response(JSON.stringify({
      status: "en_route",
      tech: {
        first_name: tech?.name?.split(' ')[0] || 'Your technician',
        color: tech?.color || '#3B82F6',
        lat: loc?.lat ?? null,
        lng: loc?.lng ?? null,
      },
      appointment: { start_time: apt.start_time, end_time: apt.end_time, service_type: apt.service_type },
    }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("get-tracking-data error:", message);
    return new Response(JSON.stringify({ error: "internal server error" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
