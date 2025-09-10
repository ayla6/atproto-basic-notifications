import {
  Client,
  ClientResponse,
  FailedClientResponse,
  simpleFetchHandler,
} from "@atcute/client";
import { JetstreamSubscription } from "@atcute/jetstream";
import {
  CanonicalResourceUri,
  Did,
  parseCanonicalResourceUri,
  ParsedCanonicalResourceUri,
  RecordKey,
} from "@atcute/lexicons";

import { AppBskyFeedPost } from "@atcute/bluesky";
import {
  ProfileViewDetailed,
  VerificationView,
} from "@atcute/bluesky/types/app/actor/defs";
import {
  ShTangledFeedStar,
  ShTangledRepoIssue,
  ShTangledRepoIssueComment,
} from "@atcute/tangled";
import {
  CompositeDidDocumentResolver,
  PlcDidDocumentResolver,
  WebDidDocumentResolver,
} from "@atcute/identity-resolver";
import { AtprotoDid } from "@atcute/lexicons/syntax";
import { XRPCProcedures, XRPCQueries } from "@atcute/lexicons/ambient";

const TARGET_DID = (process.env.TARGET_DID ||
  "did:plc:3c6vkaq7xf5kz3va3muptjh5") as Did;

const JETSTREAM_URL =
  process.env.JETSTREAM_URL ||
  "wss://jetstream2.us-east.bsky.network/subscribe";
const NTFY_URL = process.env.NTFY_URL || "http://0.0.0.0";
const BSKY_URL = process.env.BSKY_URL || "https://bsky.app";
const PDSLS_URL = process.env.PDSLS_URL || "https://pdsls.dev";
const TANGLED_URL = process.env.TANGLED_URL || "https://tangled.sh";

const CACHE_LIFETIME = 60 * 60 * 1000; // 60 minutes in milliseconds

const cache = new Map<
  string,
  { value: any; timestamp: number; lifetime: number }
>();

const getWithCache = async <T>(
  key: string,
  fetcher: () => Promise<T>,
  lifetime?: number,
): Promise<T> => {
  const cached = cache.get(key);
  const now = Date.now();

  if (cached && now - cached.timestamp < cached.lifetime) {
    return cached.value as T;
  }

  const value = await fetcher();
  cache.set(key, {
    value,
    timestamp: now,
    lifetime: lifetime ?? CACHE_LIFETIME,
  });
  return value;
};

const docResolver = new CompositeDidDocumentResolver({
  methods: {
    plc: new PlcDidDocumentResolver(),
    web: new WebDidDocumentResolver(),
  },
});

const bskyClient = new Client({
  handler: simpleFetchHandler({ service: "https://public.api.bsky.app" }),
});
const clientGetRecord = async (
  uri: ParsedCanonicalResourceUri,
): Promise<
  ClientResponse<
    XRPCQueries["com.atproto.repo.getRecord"],
    XRPCQueries["com.atproto.repo.getRecord"]
  >
> => {
  return getWithCache(
    uri.collection + uri.repo + uri.rkey,
    async () => {
      try {
        const doc = await docResolver.resolve(uri.repo as AtprotoDid);
        const atprotoPdsService = doc.service?.find(
          (s) =>
            s.id === "#atproto_pds" && s.type === "AtprotoPersonalDataServer",
        );
        const pdsServiceEndpoint = atprotoPdsService?.serviceEndpoint;
        if (!pdsServiceEndpoint || typeof pdsServiceEndpoint !== "string") {
          throw new Error("No PDS service endpoint found");
        }
        const client = new Client({
          handler: simpleFetchHandler({ service: pdsServiceEndpoint }),
        });
        return await client.get("com.atproto.repo.getRecord", { params: uri });
      } catch (err) {
        return { ok: false, data: err } as FailedClientResponse;
      }
    },
    CACHE_LIFETIME * 24,
  );
};

const getId = (profile: ProfileViewDetailed) => {
  return profile.handle !== "handle.invalid" ? profile.handle : profile.did;
};

const getProfile = async (did: Did): Promise<ProfileViewDetailed> => {
  return getWithCache(
    "bskyProfile_" + did,
    async () => {
      const profile = (
        await bskyClient.get("app.bsky.actor.getProfile", {
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

      return profile;
    },
    CACHE_LIFETIME * 4,
  );
};

const errorRepo = {
  name: "Repository not found",
};

const getTangledRepo = async (
  uri: CanonicalResourceUri,
): Promise<{ name: string }> => {
  const res = parseCanonicalResourceUri(uri);
  if (!res.ok) return errorRepo;

  return getWithCache(uri, async () => {
    const repo = (await clientGetRecord(res.value)).data;

    if ("error" in repo || !("name" in repo.value)) return errorRepo;

    return repo.value as { name: string };
  });
};

const errorIssue = {
  title: "Repository not found",
  repo: "at://did:web:fake/nope.nada/nada" as CanonicalResourceUri,
};

const getTangledIssue = async (
  uri: CanonicalResourceUri,
): Promise<{ title: string; repo: CanonicalResourceUri }> => {
  const res = parseCanonicalResourceUri(uri);
  if (!res.ok) return errorIssue;

  return getWithCache(uri, async () => {
    const repo = (await clientGetRecord(res.value)).data;

    if ("error" in repo || !("title" in repo.value)) return errorIssue;

    return repo.value as {
      title: string;
      repo: CanonicalResourceUri;
    };
  });
};

const sendNotification = async (args: {
  title?: string;
  icon?: `${string}:${string}` | undefined;
  message?: string;
  url?: string;
  priority?: number;
  picture?: string | undefined;
}) => {
  const res = await fetch(NTFY_URL, {
    method: "POST",
    headers: {
      Title: args.title ?? "",
      Icon: args.icon ?? "",
      Priority: args.priority?.toString() ?? "3",
      Click: args.url ?? "",
      Attach: args.picture ?? "",
    },
    body: args.message ?? null,
  });

  if ("error" in res) {
    console.error(JSON.stringify(res));
  }
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
    const embedTable = {
      "app.bsky.embed.external": "External Link",
      "app.bsky.embed.images": "Image",
      "app.bsky.embed.record": "Record",
      "app.bsky.embed.recordWithMedia": "Record with Media",
      "app.bsky.embed.video": "Video",
    };

    const profile = await getProfile(did);

    const typeOfPost =
      record.reply?.parent.uri.includes(TARGET_DID) ||
      record.reply?.root.uri.includes(TARGET_DID)
        ? "replied"
        : "mentioned you";

    const post = record as AppBskyFeedPost.Main;
    sendNotification({
      title: "Bluesky",
      icon: profile.avatar,
      message:
        `${getId(profile)} ${typeOfPost}: ${post.text}` +
        (post.embed
          ? (post.text.length > 0 ? " " : "") +
            `[${embedTable[post.embed.$type]}]`
          : ""),
      url: `${BSKY_URL}/profile/${profile.did}/post/${rkey}`,
    });
  },
  "app.bsky.feed.follow": async (did, rkey, record) => {
    const profile = await getProfile(did);

    sendNotification({
      title: "Bluesky",
      icon: profile.avatar,
      message: `${getId(profile)} followed you`,
      url: `${BSKY_URL}/profile/${profile.did}`,
      priority: 2,
    });
  },
  "app.bsky.graph.verification": async (
    did,
    rkey,
    record: VerificationView,
  ) => {
    const profile = await getProfile(did);

    sendNotification({
      title: "Bluesky",
      icon: profile.avatar,
      message: `${getId(profile)} verified you`,
      url: `${PDSLS_URL}/${record.uri}`,
      priority: 2,
    });
  },
  "sh.tangled.graph.follow": async (did, rkey, record) => {
    const profile = await getProfile(did);

    sendNotification({
      title: "Tangled",
      icon: profile.avatar,
      message: `${getId(profile)} followed you`,
      url: `${TANGLED_URL}/@${profile.did}`,
    });
  },
  "sh.tangled.feed.star": async (did, rkey, record: ShTangledFeedStar.Main) => {
    const profile = await getProfile(did);
    const repo = await getTangledRepo(record.subject as CanonicalResourceUri);

    sendNotification({
      title: "Tangled",
      icon: profile.avatar,
      message: `${getId(profile)} starred ${repo.name}`,
      url: `${TANGLED_URL}/@${profile.did}`,
      priority: 2,
    });
  },
  "sh.tangled.repo.issue": async (
    did,
    rkey,
    record: ShTangledRepoIssue.Main,
  ) => {
    const profile = await getProfile(did);
    const repo = await getTangledRepo(record.repo as CanonicalResourceUri);

    sendNotification({
      title: "Tangled",
      icon: profile.avatar,
      message: `${getId(profile)} opened an issue, "${record.title}", on ${repo.name}: ${record.body}`,
      url: `${TANGLED_URL}`,
    });
  },
  "sh.tangled.repo.issue.comment": async (
    did,
    rkey,
    record: ShTangledRepoIssueComment.Main,
  ) => {
    const profile = await getProfile(did);
    const issue = await getTangledIssue(record.issue as CanonicalResourceUri);
    const repo = await getTangledRepo(issue.repo as CanonicalResourceUri);

    sendNotification({
      title: "Tangled",
      icon: profile.avatar,
      message: `${getId(profile)} commented on issue "${issue.title}", on ${repo.name}: ${record.body}`,
      url: `${TANGLED_URL}/@${profile.did}`,
    });
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
