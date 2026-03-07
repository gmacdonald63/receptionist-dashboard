import { serve } from "https://deno.land/std/http/server.ts";

serve(async (req) => {
  try {
    const { company_name, contact_name, email, phone } = await req.json();

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const NOTIFY_EMAIL = Deno.env.get("DEMO_NOTIFY_EMAIL") || "gmacdonald63@gmail.com";

    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY not set — skipping email notification");
      return new Response(JSON.stringify({ error: "Email not configured" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const emailBody = `
New Demo Request from the Landing Page

Company: ${company_name}
Contact: ${contact_name}
Email: ${email}
Phone: ${phone || "Not provided"}
Submitted: ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}

---
Log in to the admin dashboard to follow up.
    `.trim();

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Reliant Support <onboarding@resend.dev>",
        to: [NOTIFY_EMAIL],
        subject: `New Demo Request: ${company_name}`,
        text: emailBody,
      }),
    });

    const result = await res.json();
    console.log("Email send result:", JSON.stringify(result));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("demo-notification error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 200, // Return 200 so the form still shows success (data was saved)
      headers: { "Content-Type": "application/json" },
    });
  }
});
