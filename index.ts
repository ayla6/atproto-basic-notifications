import {
  Client,
  CredentialManager,
  ok,
  simpleFetchHandler,
} from "@atcute/client";
import { JetstreamSubscription } from "@atcute/jetstream";
import { Did, is, RecordKey } from "@atcute/lexicons";

import { AppBskyFeedPost } from "@atcute/bluesky";
import {
  ProfileViewDetailed,
  VerificationView,
} from "@atcute/bluesky/types/app/actor/defs";

const TARGET_DID = process.env.TARGET_DID || "did:plc:3c6vkaq7xf5kz3va3muptjh5";

const JETSTREAM_URL =
  process.env.JETSTREAM_URL ||
  "wss://jetstream2.us-east.bsky.network/subscribe";
const NTFY_URL = process.env.NTFY_URL || "http://0.0.0.0";
const BSKY_URL = process.env.BSKY_URL || "https://bsky.app";
const PDSLS_URL = process.env.PDSLS_URL || "https://pdsls.dev";
const TANGLED_URL = process.env.TANGLED_URL || "https://tangled.sh";

const CACHE_LIFETIME_MS = 30 * 60 * 1000; // 30 minutes in milliseconds

const client = new Client({
  handler: simpleFetchHandler({ service: "https://public.api.bsky.app" }),
});

const profileCache = new Map<
  Did,
  { profile: ProfileViewDetailed; timestamp: number }
>();

const getProfile = async (did: Did) => {
  const cached = profileCache.get(did);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_LIFETIME_MS) {
    return cached.profile;
  }

  const profile = (
    await client.get("app.bsky.actor.getProfile", {
      params: {
        actor: did,
      },
    })
  ).data;

  if ("error" in profile)
    return {
      $type: "app.bsky.actor.defs#profileViewDetailed",
      did: did,
      handle: "handle.invalid",
      displayName: "silent error!",
    } as ProfileViewDetailed;

  profileCache.set(did, { profile, timestamp: now });
  return profile;
};

const sendNotification = async (
  title: string,
  icon: `${string}:${string}` | undefined,
  message: string,
  url: string,
  priority: number = 3,
) => {
  await fetch(NTFY_URL, {
    method: "POST",
    headers: {
      Title: title,
      Icon: icon ?? "",
      Priority: priority.toString(),
      Click: url,
    },
    body: message,
  });
};

const wantedCollections = [
  "app.bsky.feed.post",
  "app.bsky.feed.follow",
  "app.bsky.graph.verification",
  "sh.tangled.graph.follow",
  "sh.tangled.feed.star",
  "sh.tangled.repo.issue",
  "sh.tangled.repo.issue.comment",
  "sh.tangled.repo.issue.state",
];

const notificationHandlers: {
  [key in (typeof wantedCollections)[number]]: (
    did: Did,
    rkey: RecordKey,
    record: any,
  ) => void;
} = {
  "app.bsky.feed.post": async (did, rkey, record: AppBskyFeedPost.Main) => {
    const profile = await getProfile(did);

    const typeOfPost =
      record.reply?.parent.uri.includes(TARGET_DID) ||
      record.reply?.root.uri.includes(TARGET_DID)
        ? "replied"
        : "mentioned you";

    const post = record as AppBskyFeedPost.Main;
    sendNotification(
      "Bluesky",
      profile.avatar,
      `${profile.handle} ${typeOfPost}: ${post.text}`,
      `${BSKY_URL}/profile/${profile.did}/post/${rkey}`,
    );
  },
  "app.bsky.feed.follow": async (did, rkey, record) => {
    const profile = await getProfile(did);

    sendNotification(
      "Bluesky",
      profile.avatar,
      `${profile.handle} followed you`,
      `${BSKY_URL}/profile/${profile.did}`,
      2,
    );
  },
  "app.bsky.graph.verification": async (
    did,
    rkey,
    record: VerificationView,
  ) => {
    const profile = await getProfile(did);

    sendNotification(
      "Bluesky",
      profile.avatar,
      `${profile.handle} verified you`,
      `${PDSLS_URL}/${record.uri}`,
      2,
    );
  },
  "sh.tangled.graph.follow": async (did, rkey, record) => {
    const profile = await getProfile(did);

    sendNotification(
      "Tangled",
      profile.avatar,
      `${profile.handle} followed you`,
      `${TANGLED_URL}/@${profile.did}`,
      2,
    );
  },
};

async function main() {
  console.log("Started notification server.");

  const subscription = new JetstreamSubscription({
    url: JETSTREAM_URL,
    wantedCollections: wantedCollections,
  });

  for await (const event of subscription) {
    if (event.did !== TARGET_DID && event.kind === "commit") {
      const commit = event.commit;

      if (
        commit.operation === "create" &&
        wantedCollections.includes(commit.collection)
      ) {
        const record = commit.record;
        const recordText = JSON.stringify(record);

        if (recordText.includes(TARGET_DID)) {
          const handler = notificationHandlers[commit.collection];

          if (handler) {
            handler(event.did, event.commit.rkey, record);
          }
        }
      }
    }
  }
}

main();
