import { parseAtUri } from "./aturi";

export const AUTH_COLLECTION = "app.tsumugi.auth";

async function resolvePds(did: string): Promise<string> {
  let url: URL;
  if (did.startsWith("did:plc:")) {
    url = new URL(`/${encodeURIComponent(did)}`, "https://plc.directory");
  } else if (did.startsWith("did:web:")) {
    const parts = did.slice(8).split(":").map(decodeURIComponent);
    const authority = parts.shift();
    if (!authority) throw new Error("invalid did:web");
    url = new URL(
      parts.length ? `/${parts.map(encodeURIComponent).join("/")}/did.json` : "/.well-known/did.json",
      `https://${authority}`,
    );
  } else {
    throw new Error("unsupported DID method");
  }

  const response = await fetch(url, { redirect: "manual" });
  if (!response.ok) throw new Error(`DID resolution failed (${response.status})`);
  const document = (await response.json()) as {
    id?: string;
    service?: Array<{ id?: string; type?: string; serviceEndpoint?: string }>;
  };
  if (document.id !== did) throw new Error("DID document mismatch");
  const service = document.service?.find(
    (item) => item.type === "AtprotoPersonalDataServer" && item.serviceEndpoint,
  );
  if (!service?.serviceEndpoint) throw new Error("PDS not found");
  return new URL(service.serviceEndpoint).origin;
}

export async function readRepoRecord(uri: string) {
  const parsed = parseAtUri(uri);
  if (!parsed) throw new Error("invalid AT URI");
  const pds = await resolvePds(parsed.did);
  const url = new URL("/xrpc/com.atproto.repo.getRecord", pds);
  url.searchParams.set("repo", parsed.did);
  url.searchParams.set("collection", parsed.collection);
  url.searchParams.set("rkey", parsed.rkey);
  const response = await fetch(url, { redirect: "manual" });
  if (!response.ok) throw new Error(`record lookup failed (${response.status})`);
  return (await response.json()) as { uri: string; cid?: string; value: unknown };
}

export async function verifyActionProof(
  uri: string,
  action: string,
  details: Record<string, string> = {},
) {
  const parsed = parseAtUri(uri);
  if (!parsed || parsed.collection !== AUTH_COLLECTION) throw new Error("invalid proof record");
  const record = await readRepoRecord(uri);
  const value = record.value as Record<string, unknown>;
  if (value.action !== action) throw new Error("action mismatch");
  const createdAt = typeof value.createdAt === "string" ? Date.parse(value.createdAt) : NaN;
  if (!Number.isFinite(createdAt) || Math.abs(Date.now() - createdAt) > 5 * 60_000) throw new Error("proof expired");
  for (const [key, expected] of Object.entries(details)) {
    if (value[key] !== expected) throw new Error(`${key} mismatch`);
  }
  return { did: parsed.did, record };
}
