import type { APIRoute } from "astro";
import { clearSessionCookie } from "../../../lib/session";

// Clears the Tsumugi cookie. The atproto session in D1 is kept so the
// background worker can still auto-post for the creator (spec §5).
export const POST: APIRoute = ({ locals }) => {
  const secure = locals.runtime.env.TSUMUGI_ORIGIN.startsWith("https://");
  return new Response(null, {
    status: 302,
    headers: { location: "/", "set-cookie": clearSessionCookie(secure) },
  });
};
