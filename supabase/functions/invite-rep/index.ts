// supabase/functions/invite-rep/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

    // ── Authenticate caller ───────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    const jwt = authHeader?.replace("Bearer ", "");
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user: callerUser }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !callerUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerClient } = await supabase
      .from("clients")
      .select("id, is_admin")
      .eq("email", callerUser.email)
      .single();

    if (!callerClient || !callerClient.is_admin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Get target rep ────────────────────────────────────────
    const { client_id } = await req.json();
    if (!client_id) {
      return new Response(JSON.stringify({ error: "Missing client_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: targetRep, error: repError } = await supabase
      .from("clients")
      .select("id, email, company_name, is_sales_rep")
      .eq("id", client_id)
      .single();

    if (repError || !targetRep) {
      return new Response(JSON.stringify({ error: "Client not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!targetRep.is_sales_rep) {
      return new Response(JSON.stringify({ error: "not_a_rep" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Generate invite token (no Supabase email sent) ────────
    // Try "invite" first (new user). Fall back to "recovery" for resend (user already exists).
    let { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "invite",
      email: targetRep.email,
      options: { redirectTo: "https://app.reliantsupport.net" },
    });

    if (linkError) {
      console.log("invite generateLink failed, trying recovery:", linkError.message);
      ({ data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: "recovery",
        email: targetRep.email,
        options: { redirectTo: "https://app.reliantsupport.net" },
      }));
    }

    if (linkError || !linkData?.properties?.hashed_token) {
      console.error("generateLink failed:", linkError);
      throw new Error("Failed to generate invite link");
    }

    // ── Store tokens + mark invite sent ───────────────────────
    const activation_token = crypto.randomUUID();
    const { error: tokenStoreError } = await supabase
      .from("clients")
      .update({
        activation_token,
        invite_token_hash: linkData.properties.hashed_token,
        invite_sent: true,
        invite_sent_at: new Date().toISOString(),
      })
      .eq("id", targetRep.id);

    if (tokenStoreError) {
      throw new Error(`Failed to store invite tokens: ${tokenStoreError.message}`);
    }

    // ── Send branded email via Resend ─────────────────────────
    const notifyUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification`;
    const notifyRes = await fetch(notifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": Deno.env.get("SUPABASE_ANON_KEY") || "",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
      },
      body: JSON.stringify({
        template: "rep_invite",
        to: targetRep.email,
        rep_name: targetRep.company_name || targetRep.email,
        activation_token,
      }),
    });

    if (!notifyRes.ok) {
      const errBody = await notifyRes.text();
      throw new Error(`send-notification failed: ${notifyRes.status} ${errBody}`);
    }

    return new Response(JSON.stringify({ sent: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("invite-rep error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
