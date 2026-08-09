import type { APIRoute } from "astro";
import {
  listChannelsByOwner,
  listVideosByChannel,
  markChecked,
  seedKnownVideos,
} from "../../../lib/db";
import { fetchChannelRss } from "../../../lib/youtube";

export const GET: APIRoute = async ({ locals, url }) => {
  const did = url.searchParams.get("did");
  if (!did || !/^did:(plc|web):/.test(did)) return json({ error: "DIDが不正です" }, 400);

  const channels = await listChannelsByOwner(locals.runtime.env.DB, did);
  const result: Array<{
    channelId: string;
    channelTitle: string | null;
    videos: Array<{ videoId: string; title: string | null; publishedAt: string | null }>;
    error?: string;
  }> = [];

  for (const channel of channels) {
    let error: string | undefined;
    try {
      const rss = await fetchChannelRss(channel.channel_id);
      await seedKnownVideos(locals.runtime.env.DB, channel.channel_id, rss);
      await markChecked(locals.runtime.env.DB, channel.channel_id);
    } catch (cause) {
      error = (cause as Error).message;
    }
    const videos = (await listVideosByChannel(locals.runtime.env.DB, channel.channel_id))
      .filter((video) => !video.root_uri)
      .map((video) => ({
        videoId: video.video_id,
        title: video.title,
        publishedAt: video.published_at,
      }));
    result.push({
      channelId: channel.channel_id,
      channelTitle: channel.title,
      videos,
      ...(error ? { error } : {}),
    });
  }

  return json({ channels: result });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
