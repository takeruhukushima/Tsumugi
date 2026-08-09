import type { APIRoute } from "astro";
import { signValue } from "../../../../lib/session";

export const POST: APIRoute = async ({ locals }) => {
  const payload = { nonce: crypto.randomUUID(), t: Date.now() };
  const token = await signValue(payload, locals.runtime.env.SESSION_SECRET);
  return json({ token, nonce: payload.nonce });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

