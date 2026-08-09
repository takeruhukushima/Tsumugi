#!/usr/bin/env node
/**
 * Generate an ES256 private JWK for the atproto OAuth client signing key.
 *
 *   node scripts/gen-jwk.mjs
 *
 * Prints a single-line JSON JWK. Put it in `.dev.vars` (ATP_PRIVATE_JWK) for
 * local dev, and in production set it as a secret:
 *
 *   wrangler secret put ATP_PRIVATE_JWK
 *
 * The public half is derived and served at /jwks.json at runtime — you never
 * commit or expose the private `d` component.
 */
import { generateKeyPair, exportJWK } from "jose";
import { randomUUID } from "node:crypto";

const { privateKey } = await generateKeyPair("ES256", { extractable: true });
const jwk = await exportJWK(privateKey);
jwk.kid = randomUUID();
jwk.alg = "ES256";
jwk.use = "sig";

process.stdout.write(JSON.stringify(jwk) + "\n");
