// supabase/functions/send-activation-invite/index.ts
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

    // ── Authenticate caller (same pattern as invite-user) ────
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

    // Verify caller is an admin
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

    // ── Get target client ────────────────────────────────────
    const { client_id } = await req.json();
    if (!client_id) {
      return new Response(JSON.stringify({ error: "Missing client_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: targetClient, error: clientError } = await supabase
      .from("clients")
      .select("id, email, company_name")
      .eq("id", client_id)
      .single();

    if (clientError || !targetClient) {
      return new Response(JSON.stringify({ error: "Client not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Find associated deal ──────────────────────────────────
    const { data: deal, error: dealError } = await supabase
      .from("deals")
      .select("id, stripe_customer_id, client_name")
      .eq("client_email", targetClient.email)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (dealError || !deal) {
      return new Response(JSON.stringify({ error: "No deal found for this client." }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Validate setup fee was paid ───────────────────────────
    if (!deal.stripe_customer_id) {
      return new Response(JSON.stringify({ error: "setup_fee_not_paid" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Copy stripe_customer_id to clients ────────────────────
    // ── Set supabase_client_id FK on deal ─────────────────────
    const [clientUpdate, dealUpdate] = await Promise.all([
      supabase.from("clients").update({
        stripe_customer_id: deal.stripe_customer_id,
      }).eq("id", targetClient.id),
      supabase.from("deals").update({
        supabase_client_id: targetClient.id,
      }).eq("id", deal.id),
    ]);
    if (clientUpdate.error) throw new Error(`Failed to copy stripe_customer_id: ${clientUpdate.error.message}`);
    if (dealUpdate.error) throw new Error(`Failed to set supabase_client_id: ${dealUpdate.error.message}`);

    // ── Generate Supabase invite token (no email sent) ────────
    // Try "invite" first (new users). Fall back to "recovery" if user already exists.
    let { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "invite",
      email: targetClient.email,
      options: { redirectTo: "https://app.reliantsupport.net" },
    });

    if (linkError) {
      console.log("invite generateLink failed, trying recovery:", linkError.message);
      ({ data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: "recovery",
        email: targetClient.email,
        options: { redirectTo: "https://app.reliantsupport.net" },
      }));
    }

    if (linkError || !linkData?.properties?.hashed_token) {
      console.error("generateLink failed:", linkError);
      throw new Error("Failed to generate invite link");
    }

    // ── Store tokens + mark setup_complete ───────────────────
    const activation_token = crypto.randomUUID();
    const { error: tokenStoreError } = await supabase.from("clients").update({
      activation_token,
      invite_token_hash: linkData.properties.hashed_token,
      setup_complete: true,
    }).eq("id", targetClient.id);
    if (tokenStoreError) throw new Error(`Failed to store activation tokens: ${tokenStoreError.message}`);

    // ── Send activation email ─────────────────────────────────
    const notifyUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-notification`;
    const notifyRes = await fetch(notifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": Deno.env.get("SUPABASE_ANON_KEY") || "",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
      },
      body: JSON.stringify({
        template: "activation_invite",
        to: targetClient.email,
        client_name: deal.client_name || targetClient.company_name,
        company_name: targetClient.company_name,
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
    console.error("send-activation-invite error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
