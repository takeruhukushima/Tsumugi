// Minimal signed-cookie session. Holds only the logged-in DID + handle.
// Signed with SESSION_SECRET via HMAC-SHA256 (Web Crypto — works on Workers).

const COOKIE = "tsumugi_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export interface SessionData {
  did: string;
  handle: string;
}

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function signSession(
  data: SessionData,
  secret: string,
): Promise<string> {
  const payload = b64urlEncode(enc.encode(JSON.stringify(data)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return `${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<SessionData | null> {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const key = await hmacKey(secret);
  const expected = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  if (!timingSafeEqual(sig, b64urlEncode(new Uint8Array(expected)))) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
  } catch {
    return null;
  }
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function sessionCookie(value: string, secure: boolean): string {
  const attrs = [
    `${COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const attrs = [
    `${COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function readSessionToken(request: Request): string | null {
  return readCookie(request.headers.get("cookie"), COOKIE);
}

// --- generic signed values (reuses the same HMAC machinery) ---------------

export async function signValue(
  obj: unknown,
  secret: string,
): Promise<string> {
  const payload = b64urlEncode(enc.encode(JSON.stringify(obj)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return `${payload}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifyValue<T>(
  token: string,
  secret: string,
): Promise<T | null> {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const key = await hmacKey(secret);
  const expected = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  if (!timingSafeEqual(sig, b64urlEncode(new Uint8Array(expected)))) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))) as T;
  } catch {
    return null;
  }
}

const GOAUTH_COOKIE = "tsumugi_goauth";

export function goauthCookie(value: string, secure: boolean): string {
  const attrs = [
    `${GOAUTH_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=600", // 10 min — just long enough to bounce through Google
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearGoauthCookie(secure: boolean): string {
  const attrs = [`${GOAUTH_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function readGoauthToken(request: Request): string | null {
  return readCookie(request.headers.get("cookie"), GOAUTH_COOKIE);
}
