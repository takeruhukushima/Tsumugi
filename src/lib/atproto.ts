import type { D1Database } from "@cloudflare/workers-types";
import { Agent } from "@atproto/api";
import {
  NodeOAuthClient,
  atprotoLoopbackClientMetadata,
  JoseKey,
  type NodeSavedState,
  type NodeSavedStateStore,
  type NodeSavedSession,
  type NodeSavedSessionStore,
  type OAuthClientMetadataInput,
} from "@atproto/oauth-client-node";

// The scope Tsumugi needs: read the user's identity + create/manage posts.
// Spec §4.1 — start broad with transition:generic during development.
export const ATP_SCOPE = "atproto transition:generic";

// AppView-based handle resolver. Passing a URL avoids the default
// AtprotoHandleResolverNode, which relies on `node:dns` and does not run on
// Cloudflare Workers (spec §12).
const HANDLE_RESOLVER = "https://bsky.social";

type Env = {
  DB: D1Database;
  TSUMUGI_ORIGIN: string;
  ATP_PRIVATE_JWK: string;
};

// ---------------------------------------------------------------- D1 stores

/** OAuth transient state (`atp_states`). */
class D1StateStore implements NodeSavedStateStore {
  constructor(private db: D1Database) {}

  async get(key: string): Promise<NodeSavedState | undefined> {
    const row = await this.db
      .prepare("SELECT state_json FROM atp_states WHERE key = ?")
      .bind(key)
      .first<{ state_json: string }>();
    return row ? (JSON.parse(row.state_json) as NodeSavedState) : undefined;
  }

  async set(key: string, value: NodeSavedState): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO atp_states (key, state_json, created_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET state_json = excluded.state_json`,
      )
      .bind(key, JSON.stringify(value), new Date().toISOString())
      .run();
  }

  async del(key: string): Promise<void> {
    await this.db.prepare("DELETE FROM atp_states WHERE key = ?").bind(key).run();
  }
}

/**
 * Persisted OAuth sessions (`atp_sessions`). Keyed by DID. This is what lets
 * the background worker refresh a creator's session and post on their behalf
 * (spec §4.1) — it must be durable, never in-memory.
 */
class D1SessionStore implements NodeSavedSessionStore {
  constructor(private db: D1Database) {}

  async get(did: string): Promise<NodeSavedSession | undefined> {
    const row = await this.db
      .prepare("SELECT session_json FROM atp_sessions WHERE did = ?")
      .bind(did)
      .first<{ session_json: string }>();
    return row ? (JSON.parse(row.session_json) as NodeSavedSession) : undefined;
  }

  async set(did: string, value: NodeSavedSession): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO atp_sessions (did, session_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(did) DO UPDATE SET
           session_json = excluded.session_json,
           updated_at = excluded.updated_at`,
      )
      .bind(did, JSON.stringify(value), new Date().toISOString())
      .run();
  }

  async del(did: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM atp_sessions WHERE did = ?")
      .bind(did)
      .run();
  }
}

// ---------------------------------------------------------- client metadata

const isLoopback = (origin: string) => origin.startsWith("http://");

/** Client metadata, derived from TSUMUGI_ORIGIN (spec §10). */
export function clientMetadata(origin: string): OAuthClientMetadataInput {
  const redirectUri = `${origin}/auth/bsky/callback`;

  if (isLoopback(origin)) {
    // Dev: atproto loopback client. client_id host must be `localhost`; the
    // redirect points at the 127.0.0.1 loopback IP (spec §10 — not localhost).
    const clientId =
      `http://localhost` +
      `?redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(ATP_SCOPE)}`;
    return atprotoLoopbackClientMetadata(clientId);
  }

  // Production: confidential client, signs token requests with a private key.
  return {
    client_id: `${origin}/client-metadata.json`,
    client_name: "Tsumugi",
    client_uri: origin,
    redirect_uris: [redirectUri],
    scope: ATP_SCOPE,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    application_type: "web",
    token_endpoint_auth_method: "private_key_jwt",
    token_endpoint_auth_signing_alg: "ES256",
    dpop_bound_access_tokens: true,
    jwks_uri: `${origin}/jwks.json`,
  };
}

// ------------------------------------------------------------- client factory

export async function createOAuthClient(env: Env): Promise<NodeOAuthClient> {
  const origin = env.TSUMUGI_ORIGIN;
  const keyset = isLoopback(origin)
    ? undefined // loopback clients are public — no signing key
    : [await JoseKey.fromImportable(JSON.parse(env.ATP_PRIVATE_JWK))];

  return new NodeOAuthClient({
    clientMetadata: clientMetadata(origin),
    keyset,
    handleResolver: HANDLE_RESOLVER,
    stateStore: new D1StateStore(env.DB),
    sessionStore: new D1SessionStore(env.DB),
  });
}

/**
 * Restore a user's OAuth session and return an authenticated Agent. Used by
 * /api/comment (act as the logged-in viewer) and the background worker (act as
 * the creator). Throws if the session can't be restored/refreshed — the caller
 * should surface a re-auth prompt (spec §12).
 */
export async function getAgent(env: Env, did: string) {
  const client = await createOAuthClient(env);
  const session = await client.restore(did);
  return new Agent(session);
}

/** Public JWKS (private `d` stripped) for /jwks.json in production. */
export async function publicJwks(privateJwkJson: string) {
  const jwk = JSON.parse(privateJwkJson) as Record<string, unknown>;
  const { d: _d, ...pub } = jwk;
  return { keys: [pub] };
}
