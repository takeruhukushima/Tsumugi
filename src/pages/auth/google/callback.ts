import type { APIRoute } from "astro";
import { exchangeCode, fetchOwnedChannels } from "../../../lib/google";
import { seedKnownVideos, upsertChannel } from "../../../lib/db";
import { fetchChannelRss } from "../../../lib/youtube";
import {
  verifyValue,
  readGoauthToken,
  clearGoauthCookie,
} from "../../../lib/session";

interface GoauthState {
  did: string;
  state: string;
  t: number;
}

// Google OAuth redirect target (spec §4.2). Confirms channel ownership, binds
// the channel(s) to the logged-in DID, seeds existing videos, then discards the
// access token immediately.
export const GET: APIRoute = async ({ locals, url, request }) => {
  const env = locals.runtime.env;
  const secure = env.TSUMUGI_ORIGIN.startsWith("https://");
  const fail = (msg: string, status = 400) =>
    new Response(msg, { status, headers: { "set-cookie": clearGoauthCookie(secure) } });

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail("不正なコールバックです");

  const token = readGoauthToken(request);
  const parsed = token ? await verifyValue<GoauthState>(token, env.SESSION_SECRET) : null;
  if (!parsed || parsed.state !== state) return fail("stateが一致しません", 403);
  if (Date.now() - parsed.t > 600_000) return fail("セッションが失効しました", 403);

  // The DID we bind channels to comes from the signed cookie, never the client.
  const ownerDid = parsed.did;

  let accessToken: string;
  try {
    accessToken = await exchangeCode({
      code,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${env.TSUMUGI_ORIGIN}/auth/google/callback`,
    });
  } catch (err) {
    return fail(`トークン交換に失敗: ${(err as Error).message}`, 502);
  }

  let channels;
  try {
    channels = await fetchOwnedChannels(accessToken);
  } catch (err) {
    return fail(`チャンネル取得に失敗: ${(err as Error).message}`, 502);
  }
  // accessToken is now out of scope and never persisted (spec §4.2 step 6).

  for (const ch of channels) {
    await upsertChannel(env.DB, ch.id, ownerDid, ch.title);
    // Seed existing uploads so the worker only posts genuinely new ones.
    try {
      const rss = await fetchChannelRss(ch.id);
      await seedKnownVideos(env.DB, ch.id, rss);
    } catch {
      /* seeding is best-effort; worker will still avoid dupes via knownVideoIds */
    }
  }

  return new Response(null, {
    status: 302,
    headers: { location: "/settings", "set-cookie": clearGoauthCookie(secure) },
  });
};
