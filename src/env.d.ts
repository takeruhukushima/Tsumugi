/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

type D1Database = import("@cloudflare/workers-types").D1Database;

interface TsumugiEnv {
  DB: D1Database;
  TSUMUGI_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  ATP_PRIVATE_JWK: string;
  ASSETS?: unknown;
}

type Runtime = import("@astrojs/cloudflare").Runtime<TsumugiEnv>;

declare namespace App {
  interface Locals extends Runtime {
    /** DID of the logged-in Bluesky user, or null. Set by middleware. */
    user: { did: string; handle: string } | null;
  }
}
