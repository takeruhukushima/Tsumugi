// Helpers for AT-URIs (at://did/collection/rkey).

export interface AtUriParts {
  did: string;
  collection: string;
  rkey: string;
}

export function parseAtUri(uri: string): AtUriParts | null {
  const m = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  return { did: m[1], collection: m[2], rkey: m[3] };
}

/** Human-openable bsky.app link for a post record — the "this is really on
 * Bluesky" link the spec (§8) insists every comment must carry. */
export function bskyPostUrl(uri: string): string | null {
  const p = parseAtUri(uri);
  if (!p) return null;
  return `https://bsky.app/profile/${p.did}/post/${p.rkey}`;
}
