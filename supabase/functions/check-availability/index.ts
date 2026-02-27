import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUFFER_MINS = 120; // 2-hour padding between appointments
const END_OF_DAY  = 22 * 60; // Don't suggest slots past 10:00 PM

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// "HH:MM" or "HH:MM:SS" → minutes since midnight
function toMinutes(timeStr: string): number {
  const parts = timeStr.split(":");
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

// minutes since midnight → "HH:MM"
function fromMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

// Accept "10:00 AM", "2:00 PM", "14:00", "14:00:00" → "HH:MM"
function normalize(timeStr: string): string | null {
  const match12 = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    let h = parseInt(match12[1]);
    const m = match12[2];
    const period = match12[3].toUpperCase();
    if (period === "AM" && h === 12) h = 0;
    if (period === "PM" && h !== 12) h += 12;
    return `${h.toString().padStart(2, "0")}:${m}`;
  }
  const match24 = timeStr.trim().match(/^(\d{1,2}):(\d{2})/);
  if (match24) return `${match24[1].padStart(2, "0")}:${match24[2]}`;
  return null;
}

// "14:00" → "2:00 PM"
function toDisplayTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  let h = parseInt(hStr);
  const m = mStr;
  const period = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${period}`;
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const { date, time, agent_id } = await req.json();

    if (!date || !time) {
      return new Response(JSON.stringify({ error: "date and time are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    if (!agent_id) {
      return new Response(JSON.stringify({ error: "agent_id is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    const normalizedTime = normalize(time);
    if (!normalizedTime) {
      return new Response(JSON.stringify({ error: `Cannot parse time: "${time}"` }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve agent_id → client_id so we only check this client's calendar
    const { data: clientRow, error: clientError } = await supabase
      .from("clients")
      .select("id")
      .eq("retell_agent_id", agent_id)
      .single();

    if (clientError || !clientRow) {
      console.error("🚨 Client lookup failed for agent_id:", agent_id, clientError);
      return new Response(JSON.stringify({ error: "unknown agent_id" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    const clientId = clientRow.id;

    // Fetch non-cancelled appointments for this client on the given date only
    const { data: appointments, error } = await supabase
      .from("appointments")
      .select("start_time")
      .eq("client_id", clientId)
      .eq("date", date)
      .neq("status", "cancelled");

    if (error) {
      console.error("🚨 DB error:", JSON.stringify(error));
      return new Response(JSON.stringify({ error: "database error" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    const proposedMins = toMinutes(normalizedTime);
    const bookedMins   = (appointments || []).map((a) => toMinutes(a.start_time)).sort((a, b) => a - b);

    // A slot is available if no existing appointment falls within 2 hours of it
    const isConflict = (t: number) => bookedMins.some((b) => Math.abs(t - b) < BUFFER_MINS);
    const isAvailable = !isConflict(proposedMins);

    // Find the next open slot: start from the end of the last conflicting window
    let nextOpen: string | null = null;
    let nextOpenDisplay: string | null = null;
    if (!isAvailable) {
      const conflicting    = bookedMins.filter((b) => Math.abs(proposedMins - b) < BUFFER_MINS);
      const latestConflict = Math.max(...conflicting);
      const firstCandidate = latestConflict + BUFFER_MINS;

      for (let t = firstCandidate; t <= END_OF_DAY; t += 30) {
        if (!isConflict(t)) {
          nextOpen        = fromMinutes(t);
          nextOpenDisplay = toDisplayTime(nextOpen);
          break;
        }
      }
    }

    const bookedDisplay = bookedMins.map((m) => toDisplayTime(fromMinutes(m)));

    console.log(`📅 [${agent_id}] ${date} ${normalizedTime} → available: ${isAvailable}, next_open: ${nextOpen}`);

    return new Response(
      JSON.stringify({
        available:      isAvailable,
        proposed_time:  toDisplayTime(normalizedTime),
        date,
        next_open:      nextOpenDisplay,
        booked_times:   bookedDisplay,
      }),
      {
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  } catch (err) {
    console.error("🚨 Unexpected error:", err);
    return new Response(JSON.stringify({ error: "unexpected error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
});
