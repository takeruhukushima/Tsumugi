import { Agent } from "@atproto/api";
import { BrowserOAuthClient } from "@atproto/oauth-client-browser";

export const ATP_SCOPE = "atproto transition:generic";
export const AUTH_COLLECTION = "app.tsumugi.auth";

let clientPromise: Promise<BrowserOAuthClient> | undefined;
let initPromise: ReturnType<BrowserOAuthClient["init"]> | undefined;

export function getBrowserOAuthClient() {
  clientPromise ??= Promise.resolve(
    location.hostname === "127.0.0.1" || location.hostname === "[::1]"
      ? new BrowserOAuthClient({
          clientMetadata: undefined,
          handleResolver: "https://bsky.social",
        })
      : BrowserOAuthClient.load({
          clientId: `${location.origin}/client-metadata.json`,
          handleResolver: "https://bsky.social",
        }),
  );
  return clientPromise;
}

export async function initBrowserSession() {
  const client = await getBrowserOAuthClient();
  initPromise ??= client.init();
  const result = await initPromise;
  return result?.session;
}

export async function getBrowserAgent() {
  const session = await initBrowserSession();
  return session ? new Agent(session) : null;
}

export async function signInWithBluesky() {
  const client = await getBrowserOAuthClient();
  await client.signInRedirect("https://bsky.social", { scope: ATP_SCOPE });
}

export async function signOutFromBluesky(did: string) {
  const client = await getBrowserOAuthClient();
  await client.revoke(did);
}

