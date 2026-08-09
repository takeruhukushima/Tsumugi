import type { APIRoute } from "astro";
import { getVideo, getChannel, attachRoot } from "../../../../lib/db";
import { getAgent } from "../../../../lib/atproto";
import { createRootPost } from "../../../../lib/post";
import { fetchOEmbed, isValidVideoId } from "../../../../lib/youtube";
import { bskyPostUrl } from "../../../../lib/aturi";

// POST /api/video/{videoId}/create-thread — the channel owner opens the comment
// thread for a video on demand (spec milestone 3: get thread + posting working
// before the cron worker exists). Posts the root from the creator's account.
export const POST: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return json({ error: "ログインが必要です" }, 401);

  const videoId = params.videoId ?? "";
  if (!isValidVideoId(videoId)) return json({ error: "invalid videoId" }, 400);

  const env = locals.runtime.env;
  const video = await getVideo(env.DB, videoId);
  if (!video) {
    return json({ error: "この動画は登録チャンネルにありません" }, 404);
  }
  if (video.root_uri) {
    return json({ error: "すでにコメント欄があります" }, 409);
  }
  const channel = await getChannel(env.DB, video.channel_id);
  if (!channel || channel.owner_did !== user.did) {
    return json({ error: "この動画の所有者ではありません" }, 403);
  }

  let agent;
  try {
    agent = await getAgent(env, user.did);
  } catch {
    return json({ error: "Blueskyの再ログインが必要です", needsReauth: true }, 401);
  }

  try {
    const oembed = await fetchOEmbed(videoId);
    const ref = await createRootPost(agent, {
      videoId,
      videoTitle: video.title ?? oembed?.title ?? null,
      origin: env.TSUMUGI_ORIGIN,
      oembed,
    });
    await attachRoot(env.DB, videoId, ref.uri, ref.cid);
    return json({ ok: true, rootUri: ref.uri, bskyUrl: bskyPostUrl(ref.uri) });
  } catch (err) {
    return json({ error: `スレッド作成に失敗: ${(err as Error).message}` }, 502);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
