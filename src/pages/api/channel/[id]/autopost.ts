import type { APIRoute } from "astro";
import { setAutoPost } from "../../../../lib/db";

// POST /api/channel/{id}/autopost — owner toggles auto-posting (spec §6/§5).
// Accepts a form field `enabled` = "1" | "0".
export const POST: APIRoute = async ({ locals, params, request }) => {
  const user = locals.user;
  if (!user) return new Response("ログインが必要です", { status: 401 });
  const channelId = params.id;
  if (!channelId) return new Response("channel id 未指定", { status: 400 });

  const form = await request.formData();
  const enabled = form.get("enabled") === "1";
  await setAutoPost(locals.runtime.env.DB, channelId, user.did, enabled);
  return new Response(null, { status: 302, headers: { location: "/settings" } });
};
