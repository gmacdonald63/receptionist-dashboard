// supabase/functions/geocode-appointments/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const { appointment_id } = await req.json();
    if (!appointment_id) return new Response(JSON.stringify({ error: "missing appointment_id" }), { status: 400, headers: cors });

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const key = Deno.env.get("GOOGLE_GEOCODING_API_KEY");
    if (!key) return new Response(JSON.stringify({ error: "GOOGLE_GEOCODING_API_KEY not set" }), { status: 500, headers: cors });

    const { data: apt } = await sb.from("appointments").select("address, city, state, zip").eq("id", appointment_id).single();
    if (!apt) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: cors });

    const addrStr = [apt.address, apt.city, apt.state, apt.zip].filter(Boolean).join(", ");
    if (!addrStr) {
      await sb.from("appointments").update({ geocode_status: "failed" }).eq("id", appointment_id);
      return new Response(JSON.stringify({ ok: false, error: "no address" }), { headers: cors });
    }

    const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addrStr)}&key=${key}`);
    const geoData = await geoRes.json();

    if (geoData.status !== "OK" || !geoData.results?.[0]) {
      await sb.from("appointments").update({ geocode_status: "failed" }).eq("id", appointment_id);
      return new Response(JSON.stringify({ ok: false, error: geoData.status }), { headers: cors });
    }

    const { lat, lng } = geoData.results[0].geometry.location;
    await sb.from("appointments").update({ job_lat: lat, job_lng: lng, geocode_status: "success" }).eq("id", appointment_id);
    return new Response(JSON.stringify({ ok: true, lat, lng }), { headers: cors });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors });
  }
});
