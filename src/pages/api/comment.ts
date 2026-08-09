import type { APIRoute } from "astro";
import { getVideo } from "../../lib/db";
import { getAgent } from "../../lib/atproto";
import { createReply } from "../../lib/post";
import { bskyPostUrl } from "../../lib/aturi";

interface Body {
  videoId?: string;
  text?: string;
  parentUri?: string;
  parentCid?: string;
}

// POST /api/comment — create a reply in the LOGGED-IN user's PDS (spec §6).
// The acting DID always comes from the server-side session, never the client.
export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: "ログインが必要です" }, 401);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const text = body.text?.trim();
  if (!body.videoId || !text) return json({ error: "本文が空です" }, 400);
  if (text.length > 300) return json({ error: "300文字を超えています" }, 400);

  const env = locals.runtime.env;
  const video = await getVideo(env.DB, body.videoId);
  if (!video || !video.root_uri || !video.root_cid) {
    return json({ error: "この動画にはまだコメント欄がありません" }, 409);
  }

  const root = { uri: video.root_uri, cid: video.root_cid };
  // Reply to a specific comment if given, else to the thread root.
  const parent =
    body.parentUri && body.parentCid
      ? { uri: body.parentUri, cid: body.parentCid }
      : root;

  let agent;
  try {
    agent = await getAgent(env, user.did);
  } catch {
    return json(
      { error: "Blueskyの再ログインが必要です", needsReauth: true },
      401,
    );
  }

  try {
    const ref = await createReply(agent, { text, root, parent });
    return json({ uri: ref.uri, cid: ref.cid, bskyUrl: bskyPostUrl(ref.uri) });
  } catch (err) {
    return json({ error: `投稿に失敗: ${(err as Error).message}` }, 502);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
