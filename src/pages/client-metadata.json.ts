import type { APIRoute } from "astro";
import { clientMetadata } from "../lib/atproto";

// atproto OAuth client metadata document (spec §4.1). Served at
// `${ORIGIN}/client-metadata.json`, which is also the production client_id.
export const GET: APIRoute = ({ locals }) => {
  const origin = locals.runtime.env.TSUMUGI_ORIGIN;
  return new Response(JSON.stringify(clientMetadata(origin), null, 2), {
    headers: { "content-type": "application/json" },
  });
};
