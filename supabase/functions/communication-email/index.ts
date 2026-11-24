import { createClient } from "npm:@supabase/supabase-js@2";
import { convert } from "npm:html-to-text@10.0.1";
import PostalMime from "npm:postal-mime@4.2.1";

const settings = {
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  cloudflareAccount: Deno.env.get("COMMUNICATION_CLOUDFLARE_ACCOUNT") ?? "",
  cloudflareToken: Deno.env.get("COMMUNICATION_CLOUDFLARE_TOKEN") ?? "",
  from: Deno.env.get("COMMUNICATION_FROM") ?? "",
  replyAddress: Deno.env.get("COMMUNICATION_REPLY_ADDRESS") ?? "",
  replyTagPrefix: Deno.env.get("COMMUNICATION_REPLY_TAG_PREFIX") ?? "",
  portalUrl: Deno.env.get("COMMUNICATION_PORTAL_URL") ?? "https://zionoutschool.com/portal-communications.html",
  deliveryKey: Deno.env.get("COMMUNICATION_DELIVERY_KEY") ?? "",
  inboundKey: Deno.env.get("COMMUNICATION_INBOUND_KEY") ?? "",
};
const server = createClient(settings.supabaseUrl, settings.serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const encoder = new TextEncoder();
const mailbox = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const maxInboundBytes = 1048576;
const maxBodyLength = 10000;

type Delivery = {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  token: string | null;
  post_kind: string | null;
  attempts: number;
};
type DeliveryState = "pending" | "accepted" | "failed" | "uncertain";

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function authorized(request: Request, secret: string) {
  const actual = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1] ?? "";
  if (secret.length < 32 || actual.length > 256 || !actual) return false;
  const digest = (value: string) => crypto.subtle.digest("SHA-256", encoder.encode(value));
  const [expected, received] = await Promise.all([digest(secret), digest(actual)]);
  let difference = 0;
  const given = new Uint8Array(received);
  for (const [i, byte] of new Uint8Array(expected).entries()) difference |= byte ^ given[i];
  return difference === 0;
}

function replyTo(token: string | null) {
  if (!token) return undefined;
  const [name, domain] = settings.replyAddress.split("@");
  return name + "+" + settings.replyTagPrefix + token + "@" + domain;
}

function replyMailboxIsConfigured() {
  return mailbox.test(settings.replyAddress) && !settings.replyAddress.includes("+") &&
    /^[a-z0-9-]{0,20}$/.test(settings.replyTagPrefix);
}

async function send(delivery: Delivery): Promise<{ state: DeliveryState; reference?: string }> {
  const inbox = new URL(settings.portalUrl);
  if (delivery.post_kind) inbox.hash = "school-updates";
  else inbox.hash = "student-messages";
  const text = [delivery.body, "ZION outSchool Family Portal: " + inbox.href];
  if (delivery.token) text.push("Reply to this email to add your response to the student conversation.");

  const endpoint = "https://api.cloudflare.com/client/v4/accounts/" +
    settings.cloudflareAccount + "/email/sending/send";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(12000),
      headers: { Authorization: "Bearer " + settings.cloudflareToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: settings.from, to: [delivery.recipient], subject: delivery.subject,
        text: text.join("\n\n"), reply_to: replyTo(delivery.token),
      }),
    });
    if (response.status === 429) return { state: "pending" };
    if (!response.ok) return { state: response.status < 500 ? "failed" : "uncertain" };
    const payload = await response.json();
    const result = payload.result;
    if (!payload.success || result?.suppressed_recipients?.length || result?.permanent_bounces?.length) {
      return { state: "failed" };
    }
    return {
      state: result?.delivered?.length || result?.queued?.length ? "accepted" : "uncertain",
      reference: typeof result?.message_id === "string" ? result.message_id : undefined,
    };
  } catch {
    // A lost response may follow acceptance. Avoid automatically duplicating the email.
    return { state: "uncertain" };
  }
}

async function deliver() {
  if (!/^[0-9a-f]{32}$/.test(settings.cloudflareAccount) || !settings.cloudflareToken ||
    !mailbox.test(settings.from) || !replyMailboxIsConfigured()) {
    return json({ error: "Email delivery is not configured." }, 503);
  }
  try {
    const url = new URL(settings.portalUrl);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
  } catch {
    return json({ error: "The portal link is not configured." }, 503);
  }
  const { data, error } = await server.rpc("communication_claim_delivery");
  if (error) return json({ error: "Unable to load pending emails." }, 503);
  let recorded = 0;
  for (const row of (data ?? []) as Delivery[]) {
    const result = await send(row);
    const completion = await server.rpc("communication_finish_delivery", {
      delivery_id: row.id, claim_attempt: row.attempts, result_state: result.state,
      reference: result.reference ?? null,
    });
    if (!completion.error) recorded++;
  }
  return json({ processed: recorded }, recorded === data?.length ? 200 : 503);
}

async function inbound(request: Request) {
  if (!replyMailboxIsConfigured()) {
    return json({ error: "Reply mailbox is not configured." }, 503);
  }
  const envelope = await request.text();
  if (envelope.length > 1400000) return json({ error: "Reply too large." }, 413);
  let input;
  try { input = JSON.parse(envelope); } catch { return json({ error: "Invalid reply." }, 400); }
  if (typeof input?.raw !== "string" || !/^[A-Za-z0-9_+\/-]+={0,2}$/.test(input.raw) ||
    typeof input?.id !== "string" || !/^[a-f0-9]{8,64}$/.test(input.id)) {
    return json({ error: "Invalid reply." }, 400);
  }
  let message: Awaited<ReturnType<typeof PostalMime.parse>>;
  try {
    const raw = atob(input.raw.replaceAll("-", "+").replaceAll("_", "/"));
    if (raw.length > maxInboundBytes) return json({ error: "Reply too large." }, 413);
    message = await PostalMime.parse(Uint8Array.from(raw, character => character.charCodeAt(0)));
  } catch { return json({ error: "Unreadable email." }, 400); }
  const autoSubmitted = message.headers.find(header => header.key === "auto-submitted")?.value.trim();
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") return json({ ignored: true });
  const sender = message.from?.address?.toLowerCase();
  const [local, domain] = settings.replyAddress.toLowerCase().split("@");
  const localPrefix = local + "+" + settings.replyTagPrefix;
  const tokens = new Set<string>();
  for (const address of message.to ?? []) {
    if (!("address" in address) || !address.address) continue;
    const parts = address.address.toLowerCase().split("@");
    if (parts.length !== 2 || parts[1] !== domain || !parts[0].startsWith(localPrefix)) continue;
    const candidate = parts[0].slice(localPrefix.length);
    if (/^[a-f0-9]{32}$/.test(candidate)) tokens.add(candidate);
  }
  if (tokens.size !== 1 || !sender || sender.length > 254 || !mailbox.test(sender)) {
    return json({ error: "Reply is not addressed to a student conversation." }, 403);
  }
  const plain: string = message.text || (message.html && convert(message.html, {
    wordwrap: false,
    selectors: [{ selector: "blockquote", format: "skip" }, { selector: "img", format: "skip" }],
  })) || "";
  const lines = plain.replace(/\r\n/g, "\n").replaceAll("\0", "").split("\n");
  const boundary = lines.findIndex(line => /^On .{1,300} wrote:\s*$|^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i.test(line));
  const body = lines.slice(0, boundary < 0 ? lines.length : boundary).join("\n").trim();
  if (!body) return json({ error: "No reply text was found." }, 400);
  if (body.length > maxBodyLength) return json({ error: "Reply text is too long." }, 413);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(message.messageId?.trim() || input.id)));
  const reference = Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
  const { data, error } = await server.rpc("communication_email_reply", {
    reply_token: [...tokens][0], sender, message_body: body, message_reference: reference,
  });
  if (error) return json({ error: "Unable to save the reply." }, 503);
  return data ? json({ saved: true }) : json({ error: "Reply is not authorized." }, 403);
}

Deno.serve(async (request) => {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  const action = path.split("/").pop();
  if (action !== "reply" && action !== "deliver") return json({ error: "Not found." }, 404);
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!await authorized(request, action === "reply" ? settings.inboundKey : settings.deliveryKey)) {
    return json({ error: "Authentication required." }, 401);
  }
  return action === "reply" ? inbound(request) : deliver();
});
