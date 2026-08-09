import type { APIRoute } from "astro";
import { googleAuthUrl } from "../../../lib/google";
import { verifyActionProof } from "../../../lib/identity-proof";

export const POST: APIRoute = async ({ locals, request }) => {
  const env = locals.runtime.env;
  if (!env.GOOGLE_CLIENT_ID) return json({ error: "GOOGLE_CLIENT_ID が未設定です" }, 500);
  const body = await request.json().catch(() => null) as { proofUri?: string } | null;
  if (!body?.proofUri) return json({ error: "本人確認が必要です" }, 400);
  let did: string;
  try { did = (await verifyActionProof(body.proofUri, "register-channel")).did; }
  catch (error) { return json({ error: (error as Error).message }, 403); }

  const state = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO google_oauth_states (state, owner_did, created_at) VALUES (?, ?, ?)")
    .bind(state, did, new Date().toISOString()).run();
  const authUrl = googleAuthUrl({ clientId: env.GOOGLE_CLIENT_ID, redirectUri: `${env.TSUMUGI_ORIGIN}/auth/google/callback`, state });
  return json({ authUrl });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
