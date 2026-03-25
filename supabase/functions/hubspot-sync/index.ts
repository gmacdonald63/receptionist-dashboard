// supabase/functions/hubspot-sync/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STATUS_TO_STAGE: Record<string, string> = {
  onboarding_sent:    "HUBSPOT_STAGE_ONBOARDING_SENT",
  setup_in_progress:  "HUBSPOT_STAGE_SETUP_IN_PROGRESS",
  active:             "HUBSPOT_STAGE_CLOSED_WON",
  cancelled:          "HUBSPOT_STAGE_CLOSED_LOST",
};

async function hubspotRequest(apiKey: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HubSpot API error (${res.status}): ${err}`);
  }
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const hubspotKey = Deno.env.get("HUBSPOT_API_KEY");
    if (!hubspotKey) {
      console.warn("HUBSPOT_API_KEY not configured — skipping HubSpot sync");
      return new Response(JSON.stringify({ skipped: true, reason: "HUBSPOT_API_KEY not set" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pipelineId = Deno.env.get("HUBSPOT_PIPELINE_ID");
    const { deal_id, action }: { deal_id: string; action: "create" | "update" } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load deal + rep
    const { data: deal, error } = await supabase
      .from("deals")
      .select("id, client_name, client_email, client_phone, company_name, plan, billing_cycle, status, hubspot_deal_id, rep:rep_id(email, company_name)")
      .eq("id", deal_id)
      .single();

    if (error || !deal) throw new Error(`Deal not found: ${deal_id}`);

    const stageEnvKey = STATUS_TO_STAGE[deal.status];
    const stageId = stageEnvKey ? Deno.env.get(stageEnvKey) : undefined;

    const dealName = `${deal.company_name} — ${deal.plan === "pro" ? "Pro" : "Standard"} (${deal.billing_cycle === "annual" ? "Annual" : "Monthly"})`;
    const repName = deal.rep?.company_name || deal.rep?.email || "";

    const dealProperties: Record<string, string> = {
      dealname: dealName,
      ...(pipelineId ? { pipeline: pipelineId } : {}),
      ...(stageId ? { dealstage: stageId } : {}),
    };

    if (action === "create") {
      // Create contact first, then deal
      let contactId: string | undefined;
      try {
        const contactRes = await hubspotRequest(hubspotKey, "POST", "/crm/v3/objects/contacts", {
          properties: {
            email: deal.client_email,
            firstname: deal.client_name.split(" ")[0] || deal.client_name,
            lastname: deal.client_name.split(" ").slice(1).join(" ") || "",
            phone: deal.client_phone || "",
            company: deal.company_name,
          },
        });
        contactId = contactRes.id;
      } catch {
        // Contact may already exist — that's fine
        console.warn("Could not create HubSpot contact (may already exist)");
      }

      const hubspotDeal = await hubspotRequest(hubspotKey, "POST", "/crm/v3/objects/deals", {
        properties: dealProperties,
        associations: contactId ? [{
          to: { id: contactId },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }],
        }] : [],
      });

      // Save hubspot_deal_id back to Supabase
      await supabase
        .from("deals")
        .update({ hubspot_deal_id: hubspotDeal.id })
        .eq("id", deal.id);

      console.log(`HubSpot deal created: ${hubspotDeal.id} for deal ${deal.id}`);

    } else if (action === "update") {
      if (!deal.hubspot_deal_id) {
        console.warn(`No hubspot_deal_id on deal ${deal.id} — skipping update`);
        return new Response(JSON.stringify({ skipped: true, reason: "No hubspot_deal_id" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await hubspotRequest(
        hubspotKey,
        "PATCH",
        `/crm/v3/objects/deals/${deal.hubspot_deal_id}`,
        { properties: dealProperties }
      );

      console.log(`HubSpot deal updated: ${deal.hubspot_deal_id} -> ${deal.status}`);
    }

    return new Response(JSON.stringify({ synced: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("hubspot-sync error:", err);
    // Non-fatal: log but return 200 so caller doesn't treat this as a hard failure
    return new Response(JSON.stringify({ error: err.message, synced: false }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
