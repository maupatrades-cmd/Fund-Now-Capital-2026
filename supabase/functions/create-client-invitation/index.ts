import { createClient } from "npm:@supabase/supabase-js@2";
const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const appUrl = (Deno.env.get("APP_BASE_URL") ?? "").replace(/\/$/, "");
const hashSecret = Deno.env.get("CLIENT_INVITATION_HASH_SECRET") ?? "";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type":"application/json", "cache-control":"no-store" } });
async function hash(token: string) {
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${hashSecret}:${token}`));
  return [...new Uint8Array(data)].map((b) => b.toString(16).padStart(2,"0")).join("");
}
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!url || !serviceKey || !appUrl || !hashSecret) return json({ error: "Invitations are not configured" }, 503);
  const auth = req.headers.get("authorization") ?? "";
  const service = createClient(url, serviceKey, { auth: { persistSession:false, autoRefreshToken:false } });
  const { data: userData } = await service.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  const uid = userData.user?.id;
  if (!uid) return json({ error: "Unauthorised" }, 401);
  const { data: profile } = await service.from("profiles").select("id,role,referral_partner_id,is_active").eq("id",uid).single();
  if (!profile?.is_active || !["owner","partner","contractor","lead_referrer"].includes(String(profile.role))) return json({ error: "Forbidden" }, 403);
  let body: Record<string,unknown>; try { body = await req.json(); } catch { return json({ error:"Invalid request" },400); }
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = [...tokenBytes].map((b) => b.toString(16).padStart(2,"0")).join("");
  const tokenHash = await hash(raw);
  const days = Math.min(Math.max(Number(body.expires_in_days) || 14, 1), 90);
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  const partnerId = String(profile.role) === "partner" || String(profile.role) === "lead_referrer" ? profile.referral_partner_id : (String(profile.role) === "owner" && typeof body.referral_partner_id === "string" ? body.referral_partner_id : null);
  const { data, error } = await service.from("client_invitation_tokens").insert({
    token_hash: tokenHash, issuer_profile_id: uid, issuer_role: String(profile.role),
    referral_partner_id: partnerId, lead_referrer_profile_id: String(profile.role) === "lead_referrer" ? uid : null,
    campaign_name: typeof body.campaign_name === "string" ? body.campaign_name.trim().slice(0,120) : null,
    expires_at: expiresAt, max_uses: Math.min(Math.max(Number(body.max_uses) || 1,1),10000),
  }).select("id").single();
  if (error || !data) return json({ error:"Invitation could not be created" },500);
  await service.from("client_invitation_events").insert({ invitation_id:data.id,event_type:"issued",actor_profile_id:uid });
  return json({ invitation_id:data.id, invite_url:`${appUrl}/apply?invite=${raw}`, expires_at:expiresAt },201);
});