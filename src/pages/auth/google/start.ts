import type { APIRoute } from "astro";
import { googleAuthUrl } from "../../../lib/google";
import { signValue, goauthCookie } from "../../../lib/session";

// Begin channel-ownership verification (spec §4.2). Must be logged in with
// Bluesky first — we bind the Google flow to that DID.
export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return new Response("ログインが必要です", { status: 401 });

  const env = locals.runtime.env;
  if (!env.GOOGLE_CLIENT_ID) {
    return new Response("GOOGLE_CLIENT_ID が未設定です", { status: 500 });
  }

  const state = crypto.randomUUID();
  const redirectUri = `${env.TSUMUGI_ORIGIN}/auth/google/callback`;
  const stateToken = await signValue(
    { did: user.did, state, t: Date.now() },
    env.SESSION_SECRET,
  );

  const authUrl = googleAuthUrl({
    clientId: env.GOOGLE_CLIENT_ID,
    redirectUri,
    state,
  });

  const secure = env.TSUMUGI_ORIGIN.startsWith("https://");
  return new Response(null, {
    status: 302,
    headers: { location: authUrl, "set-cookie": goauthCookie(stateToken, secure) },
  });
};
