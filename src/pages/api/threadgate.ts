import type { APIRoute } from "astro";
import { getVideo, getChannel } from "../../lib/db";
import { getAgent } from "../../lib/atproto";
import { setThreadgate, type ReplyRule } from "../../lib/moderation";

interface Body {
  videoId?: string;
  rule?: ReplyRule;
}

const RULES: ReplyRule[] = ["everyone", "following", "mentioned", "nobody"];

// POST /api/threadgate — the channel owner sets who may reply to a video's
// comment thread (spec §7). Applies Bluesky's native threadgate; Tsumugi keeps
// no hidden-list of its own.
export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: "ログインが必要です" }, 401);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (!body.videoId || !body.rule || !RULES.includes(body.rule)) {
    return json({ error: "パラメータが不正です" }, 400);
  }

  const env = locals.runtime.env;
  const video = await getVideo(env.DB, body.videoId);
  if (!video || !video.root_uri) {
    return json({ error: "コメント欄がまだありません" }, 409);
  }
  // Only the channel owner may gate the thread.
  const channel = await getChannel(env.DB, video.channel_id);
  if (!channel || channel.owner_did !== user.did) {
    return json({ error: "この操作の権限がありません" }, 403);
  }

  let agent;
  try {
    agent = await getAgent(env, user.did);
  } catch {
    return json({ error: "Blueskyの再ログインが必要です", needsReauth: true }, 401);
  }

  try {
    await setThreadgate(agent, video.root_uri, body.rule);
    return json({ ok: true, rule: body.rule });
  } catch (err) {
    return json({ error: `設定に失敗: ${(err as Error).message}` }, 502);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
