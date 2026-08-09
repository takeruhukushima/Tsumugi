import type { APIRoute } from "astro";
import { AtpAgent } from "@atproto/api";
import { AUTH_COLLECTION, readRepoRecord } from "../../../../lib/identity-proof";
import { parseAtUri } from "../../../../lib/aturi";
import { upsertUser } from "../../../../lib/db";
import { sessionCookie, signSession, verifyValue } from "../../../../lib/session";

interface ProofToken {
  nonce: string;
  t: number;
}

export const POST: APIRoute = async ({ locals, request }) => {
  const body = (await request.json().catch(() => null)) as
    | { token?: string; uri?: string }
    | null;
  if (!body?.token || !body.uri) return json({ error: "invalid proof" }, 400);

  const proof = await verifyValue<ProofToken>(
    body.token,
    locals.runtime.env.SESSION_SECRET,
  );
  if (!proof || Date.now() - proof.t > 5 * 60_000) {
    return json({ error: "proof expired" }, 403);
  }

  const parsed = parseAtUri(body.uri);
  if (!parsed || parsed.collection !== AUTH_COLLECTION) {
    return json({ error: "invalid proof record" }, 400);
  }

  let record;
  try {
    record = await readRepoRecord(body.uri);
  } catch (error) {
    return json({ error: (error as Error).message }, 403);
  }
  const value = record.value as { challenge?: string };
  if (value.challenge !== proof.nonce) {
    return json({ error: "challenge mismatch" }, 403);
  }

  let handle = parsed.did;
  try {
    const agent = new AtpAgent({ service: "https://public.api.bsky.app" });
    const profile = await agent.getProfile({ actor: parsed.did });
    handle = profile.data.handle || parsed.did;
  } catch {
    // A valid repo record already proves control; handle is display-only.
  }

  await upsertUser(locals.runtime.env.DB, parsed.did, handle);
  const session = await signSession(
    { did: parsed.did, handle },
    locals.runtime.env.SESSION_SECRET,
  );
  const secure = locals.runtime.env.TSUMUGI_ORIGIN.startsWith("https://");
  return new Response(JSON.stringify({ ok: true, did: parsed.did, handle }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "set-cookie": sessionCookie(session, secure),
    },
  });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
