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
    if (error.code === "42501") return json({ message: "Sign in with an active administrator account to send invitations." }, 403);
    if (["22023", "PA001", "PA002", "PA003"].includes(error.code)) {
      return json({ code: error.code, message: error.message }, 409);
    }
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
      if (error?.status === 429) {
        return json({ message: "The email service reached its invitation limit. Keep this form open and try again later." }, 429);
      }
      return json({ message: "The invitation email did not send. Verify the address and check the account below before retrying." }, 502);
    }
    accountId = data.user.id;
    sent = true;
  }

  const { data: linked, error: completeError } = await server.rpc("portal_complete_invitation", {
    ...args, target_account: accountId, account_name: name,
  });
  if (completeError) {
    if (sent) {
      const actionable = ["22023", "PA001", "PA002", "PA003"].includes(completeError.code);
      return json({ code: actionable ? completeError.code : "SETUP_PENDING",
        message: "The invitation was sent. Portal setup is still pending. " +
          (actionable ? completeError.message : "Check the account or student link below and submit again with Resend unchecked.") }, 409);
    }
    return handleDatabaseError(completeError, "Account setup could not finish. Try again.");
  }

  return json({ sent, linked, pending: !sent && !existing.confirmed });
});
