// book-appointment Edge Function
// Deploy to Supabase with: supabase functions deploy book-appointment --no-verify-jwt
// Or deploy via Dashboard (Edge Functions > Deploy a new function)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-retell-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const args = body.args || {};

    // Extract booking details from what the caller told the agent
    const callerName = args.caller_name;
    const callerNumber = args.caller_number || body.call?.from_number || null;
    const date = args.date; // "YYYY-MM-DD"
    const startTime = args.start_time; // "HH:MM" (24h format)
    const serviceType = args.service_type || null;
    const address = args.address || null;
    const city = args.city || null;
    const state = args.state || null;
    const zip = args.zip || null;
    const notes = args.notes || null;

    // Get the agent_id from the call object to identify which client
    const agentId = body.call?.agent_id || args.agent_id;
    const callId = body.call?.call_id || null;

    // Validate required fields
    if (!callerName || !date || !startTime) {
      const missing = [];
      if (!callerName) missing.push("the caller's name");
      if (!date) missing.push("the appointment date");
      if (!startTime) missing.push("the appointment time");

      return new Response(
        JSON.stringify({
          message: `I still need ${missing.join(" and ")} to book the appointment. Could you provide that?`,
          success: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize Supabase client with service role key (bypasses RLS)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Look up the client by their Retell agent_id
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id, company_name, appointment_duration, buffer_time, timezone")
      .eq("retell_agent_id", agentId)
      .single();

    if (clientError || !client) {
      console.error("Client lookup failed:", clientError);
      return new Response(
        JSON.stringify({
          message: "I'm sorry, I'm having trouble accessing the booking system right now. Please try again later.",
          success: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const appointmentDuration = client.appointment_duration || 120;
    const bufferTime = client.buffer_time || 0;

    // Calculate end time from start time + duration
    const [startHours, startMins] = startTime.split(":").map(Number);
    const startTotalMinutes = startHours * 60 + startMins;
    const endTotalMinutes = startTotalMinutes + appointmentDuration;
    const endHours = Math.floor(endTotalMinutes / 60);
    const endMins = endTotalMinutes % 60;
    const endTime = `${String(endHours).padStart(2, "0")}:${String(endMins).padStart(2, "0")}`;

    // Verify the date is not in the past
    const dateParts = date.split("-");
    const dateObj = new Date(
      parseInt(dateParts[0]),
      parseInt(dateParts[1]) - 1,
      parseInt(dateParts[2])
    );
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (dateObj < today) {
      return new Response(
        JSON.stringify({
          message: "That date has already passed. Could you pick a future date?",
          success: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check business hours
    const dayOfWeek = dateObj.getDay();
    const { data: hours, error: hoursError } = await supabase
      .from("business_hours")
      .select("*")
      .eq("client_id", client.id)
      .eq("day_of_week", dayOfWeek)
      .single();

    if (hoursError || !hours || !hours.is_open) {
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      return new Response(
        JSON.stringify({
          message: `We're not available on ${dayNames[dayOfWeek]}s. Would you like to try a different day?`,
          success: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Convert time string to minutes
    const timeToMinutes = (timeStr) => {
      const parts = timeStr.split(":");
      return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    };

    const openMinutes = timeToMinutes(hours.open_time);
    const closeMinutes = timeToMinutes(hours.close_time);

    // Verify the slot is within business hours
    if (startTotalMinutes < openMinutes || endTotalMinutes > closeMinutes) {
      const formatTime = (mins) => {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        const ampm = h >= 12 ? "PM" : "AM";
        const h12 = h % 12 || 12;
        return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
      };
      return new Response(
        JSON.stringify({
          message: `That time is outside our business hours. We're available from ${formatTime(openMinutes)} to ${formatTime(closeMinutes)}. Would you like to pick a different time?`,
          success: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for conflicts with existing appointments
    const { data: existingAppointments, error: apptError } = await supabase
      .from("appointments")
      .select("start_time, end_time")
      .eq("client_id", client.id)
      .eq("date", date)
      .eq("status", "confirmed");

    if (apptError) {
      console.error("Appointment check failed:", apptError);
      return new Response(
        JSON.stringify({
          message: "I'm having trouble checking the schedule. Please try again.",
          success: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for overlap (including buffer time)
    const hasConflict = (existingAppointments || []).some((apt) => {
      const existingStart = timeToMinutes(apt.start_time);
      const existingEnd = timeToMinutes(apt.end_time) + bufferTime;
      return startTotalMinutes < existingEnd && endTotalMinutes > existingStart;
    });

    if (hasConflict) {
      return new Response(
        JSON.stringify({
          message: "That time slot is already booked. Would you like me to check for other available times on that day?",
          success: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // All checks passed — book the appointment
    const { data: newAppointment, error: insertError } = await supabase
      .from("appointments")
      .insert({
        client_id: client.id,
        caller_name: callerName,
        caller_number: callerNumber,
        date: date,
        start_time: startTime,
        end_time: endTime,
        service_type: serviceType,
        address: address,
        city: city,
        state: state,
        zip: zip,
        notes: notes,
        source: "ai",
        call_id: callId,
        status: "confirmed",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Insert failed:", insertError);

      // Check if it's a duplicate booking error
      if (insertError.code === "23505") {
        return new Response(
          JSON.stringify({
            message: "It looks like this appointment has already been booked. Is there anything else I can help with?",
            success: false,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          message: "I'm sorry, I wasn't able to book the appointment. Please try again.",
          success: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Format confirmation message
    const formatTime12 = (time24) => {
      const [h, m] = time24.split(":");
      const hour = parseInt(h);
      const ampm = hour >= 12 ? "PM" : "AM";
      const hour12 = hour % 12 || 12;
      return `${hour12}:${m} ${ampm}`;
    };

    const formattedDate = `${parseInt(dateParts[1])}/${parseInt(dateParts[2])}/${dateParts[0]}`;

    return new Response(
      JSON.stringify({
        message: `Your appointment has been booked for ${formattedDate} from ${formatTime12(startTime)} to ${formatTime12(endTime)}. Is there anything else I can help you with?`,
        success: true,
        appointment: {
          id: newAppointment.id,
          date: date,
          start_time: startTime,
          end_time: endTime,
          caller_name: callerName,
          service_type: serviceType,
          address: address,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        message: "I'm sorry, something went wrong while booking the appointment. Please try again.",
        success: false,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
