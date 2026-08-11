import { createClient } from "npm:@supabase/supabase-js@2";
const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const hashSecret = Deno.env.get("CLIENT_INVITATION_HASH_SECRET") ?? "";
const cors = { "access-control-allow-origin":"*", "access-control-allow-headers":"authorization, x-client-info, apikey, content-type", "access-control-allow-methods":"POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers:{...cors,"content-type":"application/json","cache-control":"no-store"} });
async function hash(value: string) {
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${hashSecret}:${value}`));
  return [...new Uint8Array(data)].map((b)=>b.toString(16).padStart(2,"0")).join("");
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ valid:false },405);
  if (!url || !serviceKey || !hashSecret) return json({ valid:false },503);
  let body: Record<string,unknown>; try { body=await req.json(); } catch { return json({valid:false},400); }
  const token = typeof body.token === "string" ? body.token.slice(0,512) : "";
  if (!token) return json({valid:false},200);
  const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const tokenHash=await hash(token);
  const {data:t}=await service.from("client_invitation_tokens")
    .select("id,destination_path,expires_at,revoked_at,max_uses,use_count")
    .eq("token_hash",tokenHash).maybeSingle();
  const valid=Boolean(t && !t.revoked_at && new Date(t.expires_at).getTime()>Date.now() && t.use_count<t.max_uses);
  if (valid && t) {
    const forwarded=req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const agent=req.headers.get("user-agent") ?? "";
    await service.from("client_invitation_events").insert({
      invitation_id:t.id,event_type:"opened",
      ip_hash:forwarded ? await hash(`ip:${forwarded}`) : null,
      user_agent_hash:agent ? await hash(`ua:${agent}`) : null,
    });
  }
  return json(valid ? {valid:true,destination_path:t?.destination_path ?? "/apply"} : {valid:false},200);
});
