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

