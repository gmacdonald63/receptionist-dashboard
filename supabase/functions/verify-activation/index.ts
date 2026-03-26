// supabase/functions/verify-activation/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { activation_token, password } = await req.json();

    if (!activation_token || !password) {
      return new Response(JSON.stringify({ error: "Missing activation_token or password" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Look up client by activation_token ───────────────────
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("id, invite_token_hash")
      .eq("activation_token", activation_token)
      .single();

    if (clientError || !client) {
      return new Response(JSON.stringify({ error: "Invalid activation link." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!client.invite_token_hash) {
      return new Response(JSON.stringify({ error: "token_expired" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Verify the Supabase invite OTP ───────────────────────
    // verifyOtp response: { data: { user: User, session: Session }, error }
    // data.user.id  → used for updateUserById
    // data.session.access_token + data.session.refresh_token → returned to frontend
    const { data: otpData, error: otpError } = await supabase.auth.admin.verifyOtp({
      token_hash: client.invite_token_hash,
      type: "invite",
    } as Parameters<typeof supabase.auth.admin.verifyOtp>[0]);

    if (otpError || !otpData?.session) {
      console.error("verifyOtp failed:", otpError);
      return new Response(JSON.stringify({ error: "token_expired" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Set the client's password ─────────────────────────────
    const { error: pwError } = await supabase.auth.admin.updateUserById(
      otpData.user.id,
      { password }
    );

    if (pwError) {
      console.error("updateUserById failed:", pwError);
      throw new Error("Failed to set password");
    }

    // ── Clear one-time fields ─────────────────────────────────
    await supabase
      .from("clients")
      .update({ activation_token: null, invite_token_hash: null })
      .eq("id", client.id);

    return new Response(JSON.stringify({
      access_token: otpData.session.access_token,
      refresh_token: otpData.session.refresh_token,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("verify-activation error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
