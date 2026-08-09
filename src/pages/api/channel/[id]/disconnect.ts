import type { APIRoute } from "astro";
import { disconnectChannel, getChannel } from "../../../../lib/db";
import { verifyActionProof } from "../../../../lib/identity-proof";

export const POST: APIRoute = async ({ locals, params, request }) => {
  const channelId = params.id;
  if (!channelId) return json({ error: "channel id 未指定" }, 400);
  const body = await request.json().catch(() => null) as { proofUri?: string } | null;
  if (!body?.proofUri) return json({ error: "本人確認が必要です" }, 400);
  let did: string;
  try { did = (await verifyActionProof(body.proofUri, "disconnect-channel", { channelId })).did; }
  catch (error) { return json({ error: (error as Error).message }, 403); }
  const channel = await getChannel(locals.runtime.env.DB, channelId);
  if (!channel || channel.owner_did !== did) return json({ error: "チャンネル所有者ではありません" }, 403);
  await disconnectChannel(locals.runtime.env.DB, channelId, did);
  return json({ ok: true });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
