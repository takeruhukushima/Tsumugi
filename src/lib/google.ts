// Raw Google OAuth 2.0 over fetch (spec §4.2). `googleapis` is too heavy for
// Workers. Used ONLY to prove channel ownership; the access token is discarded
// immediately after reading the owned channel ids.

const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const CHANNELS = "https://www.googleapis.com/youtube/v3/channels";
export const YT_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

export function googleAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const q = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: YT_SCOPE,
    state: opts.state,
    access_type: "online", // we don't need offline/refresh — one-shot check
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `${AUTH}?${q.toString()}`;
}

export async function exchangeCode(opts: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<string> {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("No access_token from Google");
  return data.access_token;
}

export interface OwnedChannel {
  id: string;
  title: string | null;
}

/**
 * The channels the authenticated Google account owns. `mine=true` is the whole
 * point: it can only return channels this account controls (spec §4.2).
 */
export async function fetchOwnedChannels(accessToken: string): Promise<OwnedChannel[]> {
  const q = new URLSearchParams({ part: "snippet", mine: "true" });
  const res = await fetch(`${CHANNELS}?${q.toString()}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`YouTube channels.list failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    items?: Array<{ id: string; snippet?: { title?: string } }>;
  };
  return (data.items ?? []).map((it) => ({
    id: it.id,
    title: it.snippet?.title ?? null,
  }));
}
