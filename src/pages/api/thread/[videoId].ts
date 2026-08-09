import type { APIRoute } from "astro";
import { getVideo } from "../../../lib/db";
import { fetchThread } from "../../../lib/thread";
import { isValidVideoId } from "../../../lib/youtube";

// GET /api/thread/{videoId} — the video's comment section, formatted from
// app.bsky.feed.getPostThread (spec §6).
export const GET: APIRoute = async ({ locals, params }) => {
  const videoId = params.videoId ?? "";
  if (!isValidVideoId(videoId)) {
    return json({ error: "invalid videoId" }, 400);
  }

  const video = await getVideo(locals.runtime.env.DB, videoId);
  if (!video || !video.root_uri) {
    // No official thread yet — the video page shows the "be the first" prompt.
    return json({ hasRoot: false, found: false, root: null, replies: [] });
  }

  const thread = await fetchThread(video.root_uri);
  return json({
    hasRoot: true,
    rootUri: video.root_uri,
    rootCid: video.root_cid,
    ...thread,
  });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
