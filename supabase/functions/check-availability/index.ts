import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TECH_BUFFER_MINS = 30; // 30-min travel buffer between a tech's appointments

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

// Normalize a variety of time formats → "HH:MM" (24-hour)
function normalize(timeStr: string): string | null {
  const cleaned = timeStr.trim();
  if (/^noon$/i.test(cleaned)) return "12:00";
  if (/^midnight$/i.test(cleaned)) return "00:00";
  const matchNoMinutes = cleaned.match(/^(\d{1,2})\s*(AM|PM)$/i);
  if (matchNoMinutes) {
    let h = parseInt(matchNoMinutes[1]);
    const period = matchNoMinutes[2].toUpperCase();
    if (period === "AM" && h === 12) h = 0;
    if (period === "PM" && h !== 12) h += 12;
    return `${h.toString().padStart(2, "0")}:00`;
  }
  const match12 = cleaned.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    let h = parseInt(match12[1]);
    const m = match12[2];
    const period = match12[3].toUpperCase();
    if (period === "AM" && h === 12) h = 0;
    if (period === "PM" && h !== 12) h += 12;
    return `${h.toString().padStart(2, "0")}:${m}`;
  }
  const match24 = cleaned.match(/^(\d{1,2}):(\d{2})/);
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

// "YYYY-MM-DD" → "YYYY-MM-DD" shifted by +days
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

// Check if a specific tech is free at a given time, considering their existing appointments + buffer
function isTechFreeAtSlot(
  techId: number | null,
  slotStartMins: number,
  slotDurationMins: number,
  appointments: { start_time: string; end_time: string | null; technician_id: number | null }[]
): boolean {
  const slotEndMins = slotStartMins + slotDurationMins;

  for (const apt of appointments) {
    // Only check appointments assigned to this tech (or unassigned if techId is null)
    if (apt.technician_id !== techId) continue;

    const aptStart = toMinutes(apt.start_time);
    const aptEnd = apt.end_time && apt.end_time !== apt.start_time
      ? toMinutes(apt.end_time)
      : aptStart + 60; // default 1hr if no end_time

    // Add buffer after the appointment for travel time
    const aptEndWithBuffer = aptEnd + TECH_BUFFER_MINS;

    // Check overlap: new slot overlaps if it starts before apt ends (with buffer) AND ends after apt starts
    // Also add buffer before: the new slot's end + buffer must not overlap the apt start
    if (slotStartMins < aptEndWithBuffer && slotEndMins + TECH_BUFFER_MINS > aptStart) {
      return false;
    }
  }
  return true;
}

// Check if ANY tech is available at a given slot
function isAnyTechFree(
  techIds: number[],
  slotStartMins: number,
  slotDurationMins: number,
  appointments: { start_time: string; end_time: string | null; technician_id: number | null }[]
): boolean {
  if (techIds.length === 0) {
    // No techs configured — fall back to global conflict check (any appointment = conflict)
    return !appointments.some(apt => {
      const aptStart = toMinutes(apt.start_time);
      const aptEnd = apt.end_time && apt.end_time !== apt.start_time
        ? toMinutes(apt.end_time)
        : aptStart + 60;
      const slotEnd = slotStartMins + slotDurationMins;
      return slotStartMins < aptEnd + TECH_BUFFER_MINS && slotEnd + TECH_BUFFER_MINS > aptStart;
    });
  }

  return techIds.some(techId => isTechFreeAtSlot(techId, slotStartMins, slotDurationMins, appointments));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Allow": "POST", ...CORS_HEADERS },
    });
  }

  try {
    const url = new URL(req.url);
    const queryAgentId = url.searchParams.get("agent_id");

    const body = await req.json();
    const args = body.args ?? body;
    const { date, time } = args;
    const serviceType: string | null = args.service_type || null;
    const findNext: number | null = args.find_next ? parseInt(args.find_next) : null;
    const agent_id = args.agent_id ?? body.call?.agent_id ?? queryAgentId;

    if (!date) {
      return new Response(JSON.stringify({ error: "date is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    // time is required only for the specific-check mode
    if (!findNext && !time) {
      return new Response(JSON.stringify({ error: "either time or find_next is required" }), {
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve agent_id → client
    const { data: clientRow, error: clientError } = await supabase
      .from("clients")
      .select("id, appointment_duration")
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
    let aptDuration = clientRow.appointment_duration || 60; // default 1hr

    // Look up service-specific duration if service_type was provided
    if (serviceType) {
      const { data: serviceMatch } = await supabase
        .from("service_types")
        .select("duration_minutes")
        .eq("client_id", clientId)
        .eq("is_active", true)
        .ilike("name", serviceType)
        .maybeSingle();

      if (serviceMatch) {
        aptDuration = serviceMatch.duration_minutes;
        console.log(`📋 Service type "${serviceType}" → ${aptDuration} min`);
      } else {
        // Fuzzy match
        const { data: fuzzyMatches } = await supabase
          .from("service_types")
          .select("name, duration_minutes")
          .eq("client_id", clientId)
          .eq("is_active", true);

        if (fuzzyMatches) {
          const normalizedInput = serviceType.toLowerCase().trim();
          const match = fuzzyMatches.find(
            (s) =>
              s.name.toLowerCase().includes(normalizedInput) ||
              normalizedInput.includes(s.name.toLowerCase())
          );
          if (match) {
            aptDuration = match.duration_minutes;
            console.log(`📋 Fuzzy matched "${serviceType}" → "${match.name}" → ${aptDuration} min`);
          } else {
            console.log(`📋 No service match for "${serviceType}", using client default: ${aptDuration} min`);
          }
        }
      }
    }

    const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    // Fetch active technicians for this client
    const { data: techs } = await supabase
      .from("technicians")
      .select("id")
      .eq("client_id", clientId)
      .eq("is_active", true);

    const techIds = (techs || []).map(t => t.id);

    // ─── FIND-NEXT MODE ───────────────────────────────────────────────────────
    if (findNext) {
      const slots: { date: string; display_date: string; time: string; time_24: string }[] = [];
      let searchDate = date;
      let daysSearched = 0;
      const MAX_DAYS = 30;
      const SLOT_STEP = 30; // check every 30 minutes

      while (slots.length < findNext && daysSearched < MAX_DAYS) {
        const dateObj = new Date(searchDate + "T00:00:00Z");
        const dayOfWeek = dateObj.getUTCDay();

        const { data: dayHours } = await supabase
          .from("business_hours")
          .select("is_open, open_time, close_time")
          .eq("client_id", clientId)
          .eq("day_of_week", dayOfWeek)
          .single();

        if (dayHours?.is_open) {
          const dayStart = toMinutes(dayHours.open_time);
          const dayEnd   = toMinutes(dayHours.close_time);

          // Fetch all appointments for this day (include tech assignment)
          const { data: appts } = await supabase
            .from("appointments")
            .select("start_time, end_time, technician_id")
            .eq("client_id", clientId)
            .eq("date", searchDate)
            .neq("status", "cancelled");

          const dayAppts = appts || [];

          for (let t = dayStart; t + aptDuration <= dayEnd && slots.length < findNext; t += SLOT_STEP) {
            if (isAnyTechFree(techIds, t, aptDuration, dayAppts)) {
              const time24 = fromMinutes(t);
              slots.push({
                date: searchDate,
                display_date: dateObj.toLocaleDateString("en-US", {
                  weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
                }),
                time: toDisplayTime(time24),
                time_24: time24,
              });
            }
          }
        }

        searchDate = addDays(searchDate, 1);
        daysSearched++;
      }

      console.log(`📅 [${agent_id}] find_next=${findNext} from ${date} → ${slots.length} slots found (${techIds.length} techs)`);

      return new Response(
        JSON.stringify({ slots }),
        { headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    // ─── SPECIFIC-CHECK MODE ──────────────────────────────────────────────────
    const normalizedTime = normalize(time!);
    if (!normalizedTime) {
      return new Response(JSON.stringify({ error: `Cannot parse time: "${time}"` }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    const dateObj = new Date(date + "T00:00:00Z");
    const dayOfWeek = dateObj.getUTCDay();

    const { data: hours, error: hoursError } = await supabase
      .from("business_hours")
      .select("is_open, open_time, close_time")
      .eq("client_id", clientId)
      .eq("day_of_week", dayOfWeek)
      .single();

    if (hoursError || !hours || !hours.is_open) {
      return new Response(
        JSON.stringify({
          available: false,
          date,
          reason: "closed",
          message: `We're not available on ${DAY_NAMES[dayOfWeek]}s. Please ask for a weekday.`,
        }),
        { headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    const START_OF_DAY = toMinutes(hours.open_time);
    const END_OF_DAY   = toMinutes(hours.close_time);

    const normalizedTimeMins = toMinutes(normalizedTime);
    if (normalizedTimeMins < START_OF_DAY || normalizedTimeMins >= END_OF_DAY) {
      return new Response(
        JSON.stringify({
          available: false,
          date,
          reason: "outside_hours",
          message: `That time is outside our business hours. We're available ${toDisplayTime(hours.open_time.slice(0, 5))} to ${toDisplayTime(hours.close_time.slice(0, 5))} on ${DAY_NAMES[dayOfWeek]}s.`,
        }),
        { headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    // Fetch all non-cancelled appointments for the day with tech info
    const { data: appointments, error } = await supabase
      .from("appointments")
      .select("start_time, end_time, technician_id")
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

    const dayAppts = appointments || [];
    const isAvailable = isAnyTechFree(techIds, normalizedTimeMins, aptDuration, dayAppts);

    let nextOpen: string | null = null;
    let nextOpenDisplay: string | null = null;
    if (!isAvailable) {
      // Find the next available slot on this day
      for (let t = normalizedTimeMins + 30; t + aptDuration <= END_OF_DAY; t += 30) {
        if (isAnyTechFree(techIds, t, aptDuration, dayAppts)) {
          nextOpen = fromMinutes(t);
          nextOpenDisplay = toDisplayTime(nextOpen);
          break;
        }
      }
    }

    // Show currently booked times for context
    const bookedMins = dayAppts.map((a) => toMinutes(a.start_time)).sort((a, b) => a - b);
    const bookedDisplay = bookedMins.map((m) => toDisplayTime(fromMinutes(m)));

    console.log(`📅 [${agent_id}] ${date} ${normalizedTime} → available: ${isAvailable}, next_open: ${nextOpen} (${techIds.length} techs)`);

    return new Response(
      JSON.stringify({
        available:     isAvailable,
        proposed_time: toDisplayTime(normalizedTime),
        date,
        next_open:     nextOpenDisplay,
        booked_times:  bookedDisplay,
      }),
      { headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  } catch (err) {
    console.error("🚨 Unexpected error:", err);
    return new Response(JSON.stringify({ error: "unexpected error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
});
