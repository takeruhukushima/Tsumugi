import type { APIRoute } from "astro";
import { exchangeCode, fetchOwnedChannels } from "../../../lib/google";
import { seedKnownVideos, upsertChannel, upsertUser } from "../../../lib/db";
import { fetchChannelRss } from "../../../lib/youtube";

// Google OAuth redirect target (spec §4.2). Confirms channel ownership, binds
// the channel(s) to the logged-in DID, seeds existing videos, then discards the
// access token immediately.
export const GET: APIRoute = async ({ locals, url }) => {
  const env = locals.runtime.env;
  const fail = (msg: string, status = 400) => new Response(msg, { status });

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail("不正なコールバックです");

  const stored = await env.DB.prepare("SELECT owner_did, created_at FROM google_oauth_states WHERE state = ?").bind(state).first<{ owner_did: string; created_at: string }>();
  await env.DB.prepare("DELETE FROM google_oauth_states WHERE state = ?").bind(state).run();
  if (!stored) return fail("stateが一致しません", 403);
  if (Date.now() - Date.parse(stored.created_at) > 600_000) return fail("セッションが失効しました", 403);
  const ownerDid = stored.owner_did;

  // channels.owner_did has a foreign key to users.did. This is public identity
  // metadata only; OAuth sessions and tokens remain exclusively in the browser.
  await upsertUser(env.DB, ownerDid, ownerDid);

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
    // Seed existing uploads so the sync screen can show unposted videos.
    try {
      const rss = await fetchChannelRss(ch.id);
      await seedKnownVideos(env.DB, ch.id, rss);
    } catch {
      /* seeding is best-effort; the sync action refreshes RSS again */
    }
  }

  return new Response(null, { status: 302, headers: { location: "/settings" } });
};
