// supabase functions deploy send-email
// Env vars in Supabase Dashboard > Edge Functions > Secrets: OWNER_EMAIL, SMTP_USER, SMTP_PASSWORD
// Sends order / form emails via Gmail SMTP using nodemailer.
import nodemailer from "npm:nodemailer@6.9.14";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
  try {
    const { subject, fields } = await req.json();
    const lines = Object.entries(fields || {}).map(([k,v]) => `${k}: ${v ?? ""}`).join("\n");
    const transporter = nodemailer.createTransport({ host: "smtp.gmail.com", port: 587, secure: false, auth: { user: Deno.env.get("SMTP_USER"), pass: (Deno.env.get("SMTP_PASSWORD")||"").replace(/ /g,"") } });
    await transporter.sendMail({ from: Deno.env.get("SMTP_USER"), to: Deno.env.get("OWNER_EMAIL") || "naija.republic.rp@gmail.com", subject: subject || "Naija Republic RP", text: lines });
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  } catch (e) { return new Response(JSON.stringify({ error: String(e) }), { status: 500 }); }
});
