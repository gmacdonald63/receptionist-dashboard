import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// Day and month name arrays for human-readable output
const DAYS   = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const now = new Date();

  // ISO date string: "2026-02-27"
  const iso = now.toISOString().split("T")[0];

  // Human-readable parts
  const dayName   = DAYS[now.getUTCDay()];
  const monthName = MONTHS[now.getUTCMonth()];
  const dayNum    = now.getUTCDate();
  const year      = now.getUTCFullYear();

  // "Thursday, February 27, 2026"
  const readable = `${dayName}, ${monthName} ${dayNum}, ${year}`;

  console.log(`📅 get-current-date called → ${iso}`);

  return new Response(
    JSON.stringify({
      date:     iso,       // "2026-02-27"  — use this for date comparisons and tool params
      readable,            // "Thursday, February 27, 2026"  — use this when speaking to the caller
      day_of_week: dayName,
      month:    monthName,
      day:      dayNum,
      year,
    }),
    { headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
  );
});
