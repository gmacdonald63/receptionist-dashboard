// supabase/functions/invite-user/index.ts
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
    // ── Authenticate caller ──────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const jwt = authHeader.replace("Bearer ", "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Verify caller is an owner ────────────────────────────────────────────
    const { data: callerClient } = await supabase
      .from("clients")
      .select("id")
      .eq("email", user.email)
      .maybeSingle();
    if (!callerClient) {
      return new Response(JSON.stringify({ error: "Only owners can send invitations" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Validate request body ────────────────────────────────────────────────
    const { email, name, role } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ error: "email is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Dedup check: email already in auth.users? ────────────────────────────
    // Using getUserByEmail (direct lookup) instead of listUsers() which only
    // returns the first 50 users and would miss existing accounts beyond that.
    const { data: existingUser } = await supabase.auth.admin.getUserByEmail(email);
    if (existingUser?.user) {
      console.log(`invite-user: ${email} already exists — skipping invite`);
      return new Response(JSON.stringify({ existing: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Send invite ──────────────────────────────────────────────────────────
    const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email);
    if (inviteError) {
      console.error("inviteUserByEmail error:", inviteError);
      return new Response(JSON.stringify({ error: inviteError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`invite-user: sent invite to ${email} (role: ${role || "unspecified"})`);
    return new Response(JSON.stringify({ sent: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("invite-user error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
