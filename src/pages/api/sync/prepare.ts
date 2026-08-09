import type { APIRoute } from "astro";
import { getChannel, getVideo, seedKnownVideos } from "../../../lib/db";
import { fetchOEmbed, parseYouTubeVideoId, resolveOEmbedChannelId } from "../../../lib/youtube";

export const POST: APIRoute = async ({ locals, request }) => {
  const body = await request.json().catch(() => null) as { did?: string; videoUrl?: string } | null;
  if (!body?.did || !/^did:(plc|web):/.test(body.did) || !body.videoUrl) return json({ error: "入力が不正です" }, 400);
  const videoId = parseYouTubeVideoId(body.videoUrl);
  if (!videoId) return json({ error: "YouTube動画URLまたは動画IDを入力してください" }, 400);

  const existing = await getVideo(locals.runtime.env.DB, videoId);
  if (existing?.root_uri) return json({ error: "この動画はすでに同期済みです" }, 409);

  const oembed = await fetchOEmbed(videoId);
  if (!oembed) return json({ error: "公開動画を取得できませんでした" }, 404);
  const channelId = await resolveOEmbedChannelId(oembed);
  if (!channelId) return json({ error: "動画のYouTubeチャンネルを確認できませんでした" }, 502);
  const channel = await getChannel(locals.runtime.env.DB, channelId);
  if (!channel || channel.owner_did !== body.did) {
    return json({ error: "この動画は登録済みの所有チャンネルの動画ではありません" }, 403);
  }

  await seedKnownVideos(locals.runtime.env.DB, channelId, [{ videoId, title: oembed.title, publishedAt: null }]);
  return json({ video: { videoId, title: oembed.title, publishedAt: null }, oembed });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
