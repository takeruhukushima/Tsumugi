import type { Agent } from "@atproto/api";
import { parseAtUri } from "./aturi";

// Threadgate control (spec §7). Tsumugi does NOT build its own moderation — it
// sets Bluesky's native app.bsky.feed.threadgate on the creator's root post.

export type ReplyRule = "everyone" | "following" | "mentioned" | "nobody";

const RULE_TYPES: Record<Exclude<ReplyRule, "everyone" | "nobody">, string> = {
  following: "app.bsky.feed.threadgate#followingRule",
  mentioned: "app.bsky.feed.threadgate#mentionRule",
};

const COLLECTION = "app.bsky.feed.threadgate";

/**
 * Set who may reply to a root post. `agent` must be the post's author (the
 * channel owner). A threadgate's rkey must equal the post's rkey.
 */
export async function setThreadgate(
  agent: Agent,
  rootUri: string,
  rule: ReplyRule,
): Promise<void> {
  const parts = parseAtUri(rootUri);
  if (!parts) throw new Error("invalid root uri");
  const repo = agent.assertDid;
  if (parts.did !== repo) throw new Error("スレッドの所有者ではありません");

  // "everyone" means: no gate at all.
  if (rule === "everyone") {
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo,
        collection: COLLECTION,
        rkey: parts.rkey,
      });
    } catch {
      /* absent already — fine */
    }
    return;
  }

  const allow =
    rule === "nobody"
      ? []
      : [{ $type: RULE_TYPES[rule] }];

  await agent.com.atproto.repo.putRecord({
    repo,
    collection: COLLECTION,
    rkey: parts.rkey,
    record: {
      $type: COLLECTION,
      post: rootUri,
      allow,
      createdAt: new Date().toISOString(),
    },
  });
}
