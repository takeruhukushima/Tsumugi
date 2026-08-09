import { defineMiddleware } from "astro:middleware";
import { readSessionToken, verifySession } from "./lib/session";

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.user = null;

  const env = context.locals.runtime?.env;
  const secret = env?.SESSION_SECRET;
  const token = readSessionToken(context.request);

  if (secret && token) {
    const data = await verifySession(token, secret);
    if (data?.did) {
      context.locals.user = { did: data.did, handle: data.handle };
    }
  }

  return next();
});
