import type { APIRoute } from "astro";
import { clearSessionCookie } from "../../../lib/session";

// Clears Tsumugi's signed app cookie. BrowserAuth separately revokes the
// BrowserOAuthClient session stored in IndexedDB.
export const POST: APIRoute = ({ locals }) => {
  const secure = locals.runtime.env.TSUMUGI_ORIGIN.startsWith("https://");
  return new Response(null, {
    status: 302,
    headers: { location: "/", "set-cookie": clearSessionCookie(secure) },
  });
};
