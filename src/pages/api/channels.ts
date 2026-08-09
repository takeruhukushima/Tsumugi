import type { APIRoute } from "astro";
import { listChannelsByOwner } from "../../lib/db";

export const GET: APIRoute = async ({ locals, url }) => {
  const did = url.searchParams.get("did");
  if (!did || !/^did:(plc|web):/.test(did)) return json({ error: "DIDが不正です" }, 400);
  const channels = await listChannelsByOwner(locals.runtime.env.DB, did);
  return json({ channels: channels.map(channel => ({ channelId: channel.channel_id, title: channel.title })) });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
