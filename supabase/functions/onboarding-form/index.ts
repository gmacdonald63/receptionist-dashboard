// ─── CONFIG ───────────────────────────────────────────────────────────────────
const STRIPE_PAYMENT_URL = 'https://buy.stripe.com/dRmfZiaNh2aU64Me3q3Je00'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = 'noreply@reliantsupport.net'
const TO_EMAIL = 'greg@reliantsupport.net'
// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let fd: FormData
  try {
    fd = await req.formData()
  } catch {
    return new Response('Bad request: could not parse form data', { status: 400 })
  }

  const get = (key: string) => fd.get(key)?.toString().trim() ?? ''
  const all = (key: string) => fd.getAll(key).map(v => v.toString().trim()).filter(Boolean)

  // Normalize website URL
  let website = get('website')
  if (website && !website.startsWith('http://') && !website.startsWith('https://')) {
    website = 'https://' + website
  }

  // Whether this submission should redirect to Stripe after sending the email
  const stripeRedirect = get('stripe_redirect') === 'true'

  // ── Collect all fields ──────────────────────────────────────────────────────
  const data = {
    // Section 1
    legal_business_name: get('legal_business_name'),
    phone_greeting_name: get('phone_greeting_name'),
    business_phone: get('business_phone'),
    business_email: get('business_email'),
    business_address: get('business_address'),
    website,
    years_in_business: get('years_in_business'),
    owner_name: get('owner_name'),
    owner_cell: get('owner_cell'),
    best_contact: get('best_contact'),
    // Section 2
    service_area: get('service_area'),
    customer_type: get('customer_type'),
    services: all('services'),
    services_other: get('services_other'),
    services_excluded: get('services_excluded'),
    free_estimates: get('free_estimates'),
    emergency_service: get('emergency_service'),
    // Section 3
    hours_mon_open: get('hours_mon_open'), hours_mon_close: get('hours_mon_close'),
    hours_tue_open: get('hours_tue_open'), hours_tue_close: get('hours_tue_close'),
    hours_wed_open: get('hours_wed_open'), hours_wed_close: get('hours_wed_close'),
    hours_thu_open: get('hours_thu_open'), hours_thu_close: get('hours_thu_close'),
    hours_fri_open: get('hours_fri_open'), hours_fri_close: get('hours_fri_close'),
    hours_sat_open: get('hours_sat_open'), hours_sat_close: get('hours_sat_close'),
    hours_sun_open: get('hours_sun_open'), hours_sun_close: get('hours_sun_close'),
    timezone: get('timezone'),
    techs_per_day: get('techs_per_day'),
    appt_length: get('appt_length'),
    lead_time: get('lead_time'),
    // Section 4
    voice_gender: get('voice_gender'),
    collect: all('collect'),
    qualifying_questions: get('qualifying_questions'),
    emergency_handling: get('emergency_handling'),
    afterhours_handling: get('afterhours_handling'),
    pricing_handling: get('pricing_handling'),
    service_fee: get('service_fee'),
    // Section 5
    technicians: get('technicians'),
    gps_tracking: get('gps_tracking'),
    // Section 6
    review_requests: get('review_requests'),
    google_review_link: get('google_review_link'),
    omw_tracking: get('omw_tracking'),
    // Section 7
    plan: get('plan'),
    phone_carrier: get('phone_carrier'),
    line_type: get('line_type'),
    forward_type: get('forward_type'),
    additional_notes: get('additional_notes'),
  }

  // ── Build HTML email ────────────────────────────────────────────────────────
  const hoursRow = (day: string, open: string, close: string) => {
    if (!open && !close) return `<tr><td style="padding:3px 8px;color:#94a3b8;width:110px">${day}</td><td style="padding:3px 8px;color:#64748b" colspan="2">Closed</td></tr>`
    return `<tr><td style="padding:3px 8px;color:#94a3b8;width:110px">${day}</td><td style="padding:3px 8px">${open || '—'}</td><td style="padding:3px 8px">${close || '—'}</td></tr>`
  }

  const row = (label: string, value: string) => {
    if (!value) return ''
    return `
      <tr>
        <td style="padding:7px 12px;color:#94a3b8;font-size:13px;white-space:nowrap;vertical-align:top;width:220px">${label}</td>
        <td style="padding:7px 12px;color:#e2e8f0;font-size:14px;vertical-align:top">${value.replace(/\n/g, '<br>')}</td>
      </tr>`
  }

  const section = (title: string, rows: string) => `
    <div style="margin-bottom:28px">
      <div style="background:#0f172a;border-radius:8px;overflow:hidden;border:1px solid #1e293b">
        <div style="background:#0A0E1A;padding:10px 16px;border-bottom:1px solid #1e293b">
          <span style="color:#22d3ee;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">${title}</span>
        </div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>
    </div>`

  const servicesDisplay = [
    ...data.services,
    ...(data.services_other ? [data.services_other] : []),
  ].join(', ') || '—'

  const planLabel: Record<string, string> = {
    Standard: 'Standard — $295/mo (locked early adopter rate)',
    Pro: 'Pro — $495/mo (locked early adopter rate)',
    'Standard-Paid': 'Standard — $495/mo + $345 setup fee',
    'Pro-Paid': 'Pro — $695/mo + $345 setup fee',
    'Not sure': 'Not sure yet',
  }

  const formType = stripeRedirect ? 'Standard Program' : 'Early Adopter Program'

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0A0E1A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0E1A;padding:32px 16px">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%">

        <!-- Header -->
        <tr><td style="background:#13192B;border-radius:10px 10px 0 0;border:1px solid #1e293b;border-bottom:none;padding:28px 32px;text-align:center">
          <div style="color:#E11D48;font-size:24px;font-weight:800;letter-spacing:2px">RELIANT<span style="display:block;font-size:11px;letter-spacing:4px;color:#64748b;font-weight:600;margin-top:2px">SUPPORT</span></div>
          <div style="color:#f1f5f9;font-size:20px;font-weight:700;margin-top:14px">New Client Setup Form</div>
          <div style="color:#64748b;font-size:13px;margin-top:6px">${formType} · Submitted ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' })}</div>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#13192B;border:1px solid #1e293b;border-top:2px solid #E11D48;border-radius:0 0 10px 10px;padding:28px 32px">

          ${section('1 · Business Basics', [
            row('Legal business name', data.legal_business_name),
            row('Phone greeting', `"${data.phone_greeting_name}"`),
            row('Business phone', data.business_phone),
            row('Business email', data.business_email),
            row('Mailing address', data.business_address),
            row('Website', data.website),
            row('Years in business', data.years_in_business),
            row('Owner / contact name', data.owner_name),
            row('Owner cell', data.owner_cell),
            row('Best time to reach', data.best_contact),
          ].join(''))}

          ${section('2 · Service Area & Services', [
            row('Service area', data.service_area),
            row('Customers served', data.customer_type),
            row('Services offered', servicesDisplay),
            row('Services excluded', data.services_excluded),
            row('Free estimates', data.free_estimates),
            row('Emergency / after-hours', data.emergency_service),
          ].join(''))}

          ${section('3 · Hours & Scheduling', `
            <tr><td colspan="2" style="padding:10px 12px">
              <table style="border-collapse:collapse;font-size:13px">
                <tr>
                  <td style="padding:3px 8px;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:1px;width:110px"></td>
                  <td style="padding:3px 8px;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:1px">Open</td>
                  <td style="padding:3px 8px;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:1px">Close</td>
                </tr>
                ${hoursRow('Monday', data.hours_mon_open, data.hours_mon_close)}
                ${hoursRow('Tuesday', data.hours_tue_open, data.hours_tue_close)}
                ${hoursRow('Wednesday', data.hours_wed_open, data.hours_wed_close)}
                ${hoursRow('Thursday', data.hours_thu_open, data.hours_thu_close)}
                ${hoursRow('Friday', data.hours_fri_open, data.hours_fri_close)}
                ${hoursRow('Saturday', data.hours_sat_open, data.hours_sat_close)}
                ${hoursRow('Sunday', data.hours_sun_open, data.hours_sun_close)}
              </table>
            </td></tr>
            ${row('Time zone', data.timezone)}
            ${row('Techs / crews per day', data.techs_per_day)}
            ${row('Fallback appointment length', data.appt_length)}
            ${row('Scheduling lead time', data.lead_time)}
          `)}

          ${section('4 · Call Handling', [
            row('Receptionist voice', data.voice_gender),
            row('Collect from caller', data.collect.join(', ') || '—'),
            row('Qualifying questions', data.qualifying_questions),
            row('Emergency definition', data.emergency_handling),
            row('After-hours handling', data.afterhours_handling),
            row('Quote pricing?', data.pricing_handling),
            row('Service / diagnostic fee', data.service_fee),
          ].join(''))}

          ${section('5 · Team', [
            row('Technicians', data.technicians),
            row('GPS / dispatcher map', data.gps_tracking),
          ].join(''))}

          ${section('6 · Customer Communications', [
            row('Review requests', data.review_requests),
            row('Google review link', data.google_review_link),
            row('"On My Way" tracking texts', data.omw_tracking),
          ].join(''))}

          ${section('7 · Plan & Phone Setup', [
            row('Selected plan', planLabel[data.plan] ?? data.plan),
            row('Phone carrier', data.phone_carrier),
            row('Line type', data.line_type),
            row('Call forwarding preference', data.forward_type),
            row('Additional notes', data.additional_notes),
          ].join(''))}

        </td></tr>

        <!-- Footer -->
        <tr><td style="padding-top:20px;text-align:center;color:#475569;font-size:12px">
          Reliant Support · greg@reliantsupport.net
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  // ── Send via Resend ─────────────────────────────────────────────────────────
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not set — cannot send onboarding notification')
    return new Response(JSON.stringify({ error: 'Email not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const subject = `New client setup — ${data.legal_business_name || data.owner_name || 'Unknown'}`

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: TO_EMAIL,
      subject,
      html,
    }),
  })

  if (!resendRes.ok) {
    const err = await resendRes.text()
    console.error('Resend error:', err)
    return new Response('Failed to send email. Please contact greg@reliantsupport.net directly.', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  // ── Redirect: standard form goes to Stripe, early adopter goes to thank-you ─
  if (stripeRedirect) {
    return new Response(null, {
      status: 303,
      headers: { Location: STRIPE_PAYMENT_URL },
    })
  }

  // Early adopter thank-you page
  return new Response(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Thank you — Reliant Support</title>
  <style>
    body { margin:0; background:#0A0E1A; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .card { background:#13192B; border:1px solid #1e293b; border-top:3px solid #22D3EE; border-radius:12px; padding:48px 40px; max-width:480px; text-align:center; }
    .icon { font-size:48px; margin-bottom:16px; }
    h1 { color:#f1f5f9; font-size:24px; margin:0 0 12px; }
    p { color:#94a3b8; font-size:15px; line-height:1.6; margin:0 0 10px; }
    a { color:#22D3EE; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>You're all set!</h1>
    <p>Your setup information has been received. Greg will build out your receptionist and dashboard, then reach out to walk you through your call-forwarding setup and do a test call together.</p>
    <p>If you have any questions, send them to Greg at <a href="mailto:greg@reliantsupport.net">greg@reliantsupport.net</a></p>
  </div>
</body>
</html>`, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
})
