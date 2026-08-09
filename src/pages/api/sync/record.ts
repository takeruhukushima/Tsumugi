import type { APIRoute } from "astro";
import { parseAtUri } from "../../../lib/aturi";
import { attachRoot, getChannel, getVideo } from "../../../lib/db";
import { readRepoRecord } from "../../../lib/identity-proof";
import { isValidVideoId } from "../../../lib/youtube";

export const POST: APIRoute = async ({ locals, request }) => {
  const body = (await request.json().catch(() => null)) as
    | { videoId?: string; uri?: string; cid?: string }
    | null;
  if (!body?.videoId || !isValidVideoId(body.videoId) || !body.uri || !body.cid) {
    return json({ error: "同期結果が不正です" }, 400);
  }

  const video = await getVideo(locals.runtime.env.DB, body.videoId);
  if (!video) return json({ error: "動画が登録されていません" }, 404);
  if (video.root_uri) return json({ error: "すでに同期済みです" }, 409);
  const channel = await getChannel(locals.runtime.env.DB, video.channel_id);
  if (!channel) return json({ error: "チャンネルが登録されていません" }, 404);

  const parsed = parseAtUri(body.uri);
  if (
    !parsed ||
    parsed.did !== channel.owner_did ||
    parsed.collection !== "app.bsky.feed.post"
  ) {
    return json({ error: "Bluesky投稿の作成者が一致しません" }, 403);
  }

  let record;
  try {
    record = await readRepoRecord(body.uri);
  } catch (error) {
    return json({ error: `投稿を検証できません: ${(error as Error).message}` }, 403);
  }
  if (record.cid !== body.cid) return json({ error: "投稿CIDが一致しません" }, 409);
  const value = record.value as { text?: string };
  if (!value.text?.includes(`youtu.be/${body.videoId}`)) {
    return json({ error: "投稿に対象のYouTube動画が含まれていません" }, 400);
  }

  await attachRoot(locals.runtime.env.DB, body.videoId, body.uri, body.cid);
  return json({ ok: true });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
