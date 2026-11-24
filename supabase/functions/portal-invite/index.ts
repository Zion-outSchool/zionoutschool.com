import { createClient } from "npm:@supabase/supabase-js@2";

const site = new URL(Deno.env.get("PORTAL_SITE_URL") || "https://zionoutschool.com");
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const server = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

const allowedOrigins = new Set([site.origin, "https://zionoutschool.com", "https://www.zionoutschool.com"]);
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return new Response(null, { status: 403 });

  const headers = {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  const json = (body: object, status = 200) => Response.json(body, { headers, status });
  if (request.method === "OPTIONS") return new Response(null, { headers, status: 204 });
  if (request.method !== "POST") return json({ message: "Method not allowed." }, 405);

  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return json({ message: "Sign in as an administrator first." }, 401);
  const { data: { user }, error: authError } = await server.auth.getUser(token);
  if (authError || !user) return json({ message: "Sign in again to continue." }, 401);

  const { data: actor, error: actorError } = await server.from("portal_users").select("role, active")
    .eq("id", user.id).maybeSingle();
  if (actorError) return json({ message: "Administrator access could not be checked." }, 503);
  if (actor?.role !== "admin" || !actor.active) return json({ message: "Administrator access is required." }, 403);

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const role = body?.role;
  const students = body?.students;
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name ||
    name.length > 120 || !["family", "teacher"].includes(role) || !Array.isArray(students) ||
    students.length > 50 || !students.every((id) => typeof id === "string" && uuid.test(id))) {
    return json({ message: "Enter a valid name, email, role, and student selection." }, 400);
  }

  const args = {
    actor_id: user.id, invite_email: email, invite_role: role,
    student_ids: [...new Set(students.map((id: string) => id.toLowerCase()))],
  };
  const handleDatabaseError = (error: { code: string; message: string }, fallback: string) => {
    if (error.code === "42501") return json({ message: "Administrator access is required." }, 403);
    if (error.code === "22023") return json({ message: error.message }, 409);
    return json({ message: fallback }, 503);
  };

  const { data: existing, error: preflightError } = await server.rpc("portal_prepare_invitation", args).single<{
    account_id: string | null; confirmed: boolean;
  }>();
  if (preflightError) return handleDatabaseError(preflightError, "Account and student links could not be checked.");
  if (!existing) return json({ message: "The account check returned no result." }, 503);

  let accountId = existing.account_id;
  let sent = false;
  if (!accountId || (body.resend === true && !existing.confirmed)) {
    const { data, error } = await server.auth.admin.inviteUserByEmail(email, {
      redirectTo: new URL("/portal-activate.html", site).href,
    });
    if (error || !data.user) {
      return json({ message: "Supabase could not send the invitation. Check the email and try again." }, 502);
    }
    accountId = data.user.id;
    sent = true;
  }

  const { data: linked, error: completeError } = await server.rpc("portal_complete_invitation", {
    ...args, target_account: accountId, account_name: name,
  });
  if (completeError) {
    if (sent) {
      const conflict = completeError.code === "22023" ? ` ${completeError.message}` : "";
      return json({ message: `The email was sent, but account setup could not finish.${conflict} Review the student selection and try again.` }, 409);
    }
    return handleDatabaseError(completeError, "Account setup could not finish. Try again.");
  }

  return json({ sent, linked, pending: !sent && !existing.confirmed });
});
