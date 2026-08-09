import type { APIRoute } from "astro";
import { publicJwks } from "../lib/atproto";

// Public JWKS for the atproto OAuth confidential client (production).
export const GET: APIRoute = async ({ locals }) => {
  const jwk = locals.runtime.env.ATP_PRIVATE_JWK;
  const body = jwk ? await publicJwks(jwk) : { keys: [] };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { "content-type": "application/json" },
  });
};
