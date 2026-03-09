import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agent_id, demo_token } = await req.json();

    // Validate the caller has demo access
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (demo_token) {
      // Public demo: validate token
      const { data: token } = await supabase
        .from("demo_tokens")
        .select("id, expires_at")
        .eq("id", demo_token)
        .gt("expires_at", new Date().toISOString())
        .single();

      if (!token) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired demo token" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    // If no demo_token, we trust the request came from an authenticated session
    // (the frontend only calls this from the demo dashboard)

    // Call Retell API to create a web call
    const retellApiKey = Deno.env.get("RETELL_API_KEY");
    if (!retellApiKey) {
      throw new Error("RETELL_API_KEY not configured");
    }

    const retellResponse = await fetch("https://api.retellai.com/v2/create-web-call", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${retellApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent_id: agent_id || "agent_be6189dedb9fa036a84c3dda19",
        metadata: {
          source: "demo_dashboard",
        },
      }),
    });

    if (!retellResponse.ok) {
      const errText = await retellResponse.text();
      console.error("Retell API error:", retellResponse.status, errText);
      throw new Error(`Retell API error: ${retellResponse.status}`);
    }

    const retellData = await retellResponse.json();

    return new Response(
      JSON.stringify({
        access_token: retellData.access_token,
        call_id: retellData.call_id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("create-web-call error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
