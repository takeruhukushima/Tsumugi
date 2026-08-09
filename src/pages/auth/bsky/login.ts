import type { APIRoute } from "astro";
import { createOAuthClient, ATP_SCOPE } from "../../../lib/atproto";

// Start the Bluesky OAuth flow. Optional ?handle= lets users on non-bsky.social
// PDSes point the flow at their own server; otherwise we use the bsky.social
// entryway.
export const GET: APIRoute = async ({ locals, url, redirect }) => {
  const client = await createOAuthClient(locals.runtime.env);
  const input = url.searchParams.get("handle")?.trim() || "https://bsky.social";
  try {
    const authUrl = await client.authorize(input, { scope: ATP_SCOPE });
    return redirect(authUrl.toString(), 302);
  } catch (err) {
    return new Response(
      `ログインを開始できませんでした: ${(err as Error).message}`,
      { status: 400 },
    );
  }
};
