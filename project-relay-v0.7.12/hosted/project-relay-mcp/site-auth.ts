import { SITE_ID, SITE_ORIGIN, GATEWAY_KEY_SHA256 } from "./site-config.ts";

// Only this private Site may attest its platform-authenticated visitor.
// A gateway credential alone never manufactures a linked Relay user.
async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
}
export async function siteSubject(req: Request): Promise<string | null> {
  const key = req.headers.get("x-relay-sites-key") || "";
  const subject = req.headers.get("x-relay-sites-user") || "";
  if (!key || !subject || subject.length > 512) return null;
  if (await hash(key) !== GATEWAY_KEY_SHA256) return null;
  return hash(SITE_ID + ":" + subject);
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
});

export async function authorizeSite(req: Request, db: any) {
  const subject = await siteSubject(req);
  if (!subject) return null;
  const { data: link, error } = await db.from("project_relay_site_links")
    .select("relay_user_id,expires_at,revoked_at,scope")
    .eq("site_id", SITE_ID).eq("subject_hash", subject).maybeSingle();
  if (error) throw error;
  if (!link || link.revoked_at || !(Date.parse(link.expires_at) > Date.now()) || link.scope !== "relay:inspect") return null;
  const { data: userData, error: userError } = await db.auth.admin.getUserById(link.relay_user_id);
  if (userError || !userData.user) return null;
  const { data: account, error: accountError } = await db.from("project_relay_accounts")
    .select("plan,status,entitlements,trial_ends_at").eq("user_id", userData.user.id).maybeSingle();
  if (accountError) throw accountError;
  if (!account || !["active", "trial"].includes(account.status)) return null;
  return {
    kind: "oauth", subject: userData.user.id, email: userData.user.email ?? null,
    name: typeof userData.user.user_metadata?.full_name === "string" ? userData.user.user_metadata.full_name : null,
    client_id: SITE_ORIGIN, scope: "relay:inspect", plan: account.plan,
    account_status: account.status, entitlements: account.entitlements ?? {},
  };
}

export async function siteAccountRoute(req: Request, db: any): Promise<Response> {
  const subject = await siteSubject(req);
  if (!subject) return json({ error: "Sign in with ChatGPT to continue." }, 401);
  if (req.method === "GET") {
    const identity = await authorizeSite(req, db);
    return json({ linked: !!identity, email: identity?.email ?? null });
  }
  if (req.method === "DELETE") {
    const { error } = await db.from("project_relay_site_links")
      .update({ revoked_at: new Date().toISOString() }).eq("site_id", SITE_ID).eq("subject_hash", subject);
    if (error) throw error;
    return json({ linked: false });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Sign in to your Relay account." }, 401);
  // Supabase verifies the actual user session; never link by email or metadata.
  const { data, error } = await db.auth.getUser(auth.slice(7));
  if (error || !data.user) return json({ error: "Relay sign-in expired. Please sign in again." }, 401);
  const { data: account, error: accountError } = await db.from("project_relay_accounts")
    .select("status").eq("user_id", data.user.id).maybeSingle();
  if (accountError) throw accountError;
  if (!account || !["active", "trial"].includes(account.status)) return json({ error: "This Relay account is not active." }, 403);
  const { error: saveError } = await db.from("project_relay_site_links").upsert({
    site_id: SITE_ID, subject_hash: subject, relay_user_id: data.user.id,
    scope: "relay:inspect", linked_at: new Date().toISOString(), revoked_at: null,
    expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
  }, { onConflict: "site_id,subject_hash" });
  if (saveError) throw saveError;
  return json({ linked: true, email: data.user.email ?? null });
}
