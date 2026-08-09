import type { APIRoute } from "astro";
import { disconnectChannel } from "../../../../lib/db";

// POST /api/channel/{id}/disconnect — owner unregisters a channel (spec §6).
// Only removes Tsumugi's mapping; posts already in the creator's PDS are kept.
export const POST: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return new Response("ログインが必要です", { status: 401 });
  const channelId = params.id;
  if (!channelId) return new Response("channel id 未指定", { status: 400 });

  await disconnectChannel(locals.runtime.env.DB, channelId, user.did);
  return new Response(null, { status: 302, headers: { location: "/settings" } });
};
