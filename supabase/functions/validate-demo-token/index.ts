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
    const { token } = await req.json();

    if (!token) {
      return new Response(
        JSON.stringify({ valid: false, error: "No token provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check if token exists and is not expired
    const { data: tokenRecord, error } = await supabase
      .from("demo_tokens")
      .select("id, created_by, created_at, expires_at")
      .eq("id", token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (error || !tokenRecord) {
      return new Response(
        JSON.stringify({ valid: false, error: "Invalid or expired demo token" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch demo client data
    const { data: demoClient } = await supabase
      .from("clients")
      .select("*")
      .eq("id", 9999)
      .single();

    if (!demoClient) {
      return new Response(
        JSON.stringify({ valid: false, error: "Demo account not found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        valid: true,
        demo_client_data: demoClient,
        expires_at: tokenRecord.expires_at,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("validate-demo-token error:", err);
    return new Response(
      JSON.stringify({ valid: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
