import type { APIRoute } from "astro";

const ATP_SCOPE = "atproto transition:generic";

// atproto OAuth client metadata document (spec §4.1). Served at
// `${ORIGIN}/client-metadata.json`, which is also the production client_id.
export const GET: APIRoute = ({ locals }) => {
  const origin = locals.runtime.env.TSUMUGI_ORIGIN;
  const metadata = {
    client_id: `${origin}/client-metadata.json`,
    client_name: "Tsumugi",
    client_uri: origin,
    redirect_uris: [`${origin}/`],
    scope: ATP_SCOPE,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    application_type: "web",
    token_endpoint_auth_method: "none",
    dpop_bound_access_tokens: true,
  };
  return new Response(JSON.stringify(metadata, null, 2), {
    headers: { "content-type": "application/json" },
  });
};
