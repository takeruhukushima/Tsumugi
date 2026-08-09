import type { APIRoute } from "astro";
import { Agent } from "@atproto/api";
import { createOAuthClient } from "../../../lib/atproto";
import { upsertUser } from "../../../lib/db";
import { signSession, sessionCookie } from "../../../lib/session";

// atproto OAuth redirect target (spec §4.1). Exchanges the code, persists the
// session (via the D1 sessionStore inside the client), and sets our cookie.
export const GET: APIRoute = async ({ locals, url }) => {
  const env = locals.runtime.env;
  const client = await createOAuthClient(env);

  let did: string;
  try {
    const { session } = await client.callback(url.searchParams);
    did = session.did;
  } catch (err) {
    return new Response(`ログインに失敗しました: ${(err as Error).message}`, {
      status: 400,
    });
  }

  // Resolve the handle for display and store the user.
  let handle = did;
  try {
    const restored = await client.restore(did);
    const agent = new Agent(restored);
    const prof = await agent.getProfile({ actor: did });
    handle = prof.data.handle ?? did;
  } catch {
    /* non-fatal — fall back to DID */
  }
  await upsertUser(env.DB, did, handle);

  const token = await signSession({ did, handle }, env.SESSION_SECRET);
  const secure = env.TSUMUGI_ORIGIN.startsWith("https://");
  return new Response(null, {
    status: 302,
    headers: {
      location: "/settings",
      "set-cookie": sessionCookie(token, secure),
    },
  });
};
