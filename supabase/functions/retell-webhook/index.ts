console.log("🚨 FUNCTION FILE LOADED");
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
serve(async (req) => {
  try {
    const payload = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const call = payload.call;
    if (!call) {
      return new Response("No call object", { status: 200 });
    }
    // Retell puts all structured data in call_analysis.custom_analysis_data
    const analysis   = call.call_analysis || {};
    const customData = analysis.custom_analysis_data || {};
    console.log("🔍 customData:", JSON.stringify(customData));
    const callerName   = customData.caller_name         ?? null;
    const callerNumber = customData.caller_phone_number ?? call.from_number ?? null;
    const apptDate     = customData.appointment_date    ?? null;
    const apptTime     = customData.appointment_time    ?? null;
    const apptAddress  = customData.appointment_address ?? null;
    const apptCity     = customData.appointment_city    ?? null;
    const apptState    = customData.appointment_state   ?? null;
    const apptZip      = customData.appointment_zip     ?? null;
    const serviceType  = customData.service_type        ?? customData.issue ?? null;
    // Insert call log
    const { error: callError } = await supabase.from("calls").insert({
      call_id:            call.call_id,
      caller_name:        callerName,
      caller_number:      callerNumber,
      summary:            analysis.call_summary ?? null,
      transcript:         call.transcript       ?? null,
      recording_url:      call.recording_url    ?? null,
      duration_seconds:   call.call_duration    ?? null,
      appointment_booked: !!(apptDate && apptTime),
      agent_id:           call.agent_id         ?? null,
    });
    if (callError) console.error("🚨 Call insert error:", JSON.stringify(callError));
    // If appointment data was collected, write it to appointments table
    if (apptDate && apptTime) {
      // Look up the client_id using the agent_id so the appointment
      // appears in the right dashboard account
      const { data: clientRow, error: clientError } = await supabase
        .from("clients")
        .select("id")
        .eq("retell_agent_id", call.agent_id)
        .single();
      if (clientError) console.error("🚨 Client lookup error:", JSON.stringify(clientError));
      console.log("📋 Inserting appointment with city/state/zip:", apptCity, apptState, apptZip);
      const { error: apptError } = await supabase.from("appointments").insert({
        client_id:     clientRow?.id    ?? null,
        caller_name:   callerName,
        caller_number: callerNumber,
        date:          apptDate,
        start_time:    apptTime,
        end_time:      null,
        address:       apptAddress,
        city:          apptCity,
        state:         apptState,
        zip:           apptZip,
        service_type:  serviceType,
        notes:         analysis.call_summary ?? null,
        source:        'call',
        status:        'confirmed',
      });
      if (apptError) console.error("🚨 Appointment insert error:", JSON.stringify(apptError));
    }
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response("Webhook error", { status: 500 });
  }
});
