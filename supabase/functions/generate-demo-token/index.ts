import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Create a fresh token — expires in 1 hour
    const { data, error } = await supabase
      .from("demo_tokens")
      .insert([{ created_by: 9999 }])
      .select("id")
      .single();

    if (error || !data) {
      console.error("Failed to create demo token:", error);
      return new Response(JSON.stringify({ error: "Failed to create demo token" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dashboardUrl = Deno.env.get("DASHBOARD_URL") || "https://app.reliantsupport.net";
    const redirectUrl = `${dashboardUrl}?demo=${data.id}`;

    // Redirect the browser directly to the dashboard with the fresh token
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: redirectUrl,
      },
    });
  } catch (err) {
    console.error("generate-demo-token error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
