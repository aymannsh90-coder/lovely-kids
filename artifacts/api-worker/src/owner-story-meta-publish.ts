/**
 * Meta Graph API image-story publication. Only call after the owner has
 * confirmed a validated, database-backed story preview.
 *
 * Never log credentials or raw upstream errors (which may echo tokens/URLs).
 */
export const STORY_GRAPH_VERSION = "v27.0";

type MetaReply = {
  id?: string;
  post_id?: string;
  success?: boolean;
  status_code?: string;
  error?: { code?: number; error_subcode?: number };
};

export class StoryMetaError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "StoryMetaError";
  }
}

export function safeMetaError(error: unknown): string {
  if (error instanceof StoryMetaError) {
    const code = error.message.match(/^(?:STORY_META_ERROR_\d+(?:_\d+)?|STORY_NOT_READY|STORY_MEDIA_PROCESSING_ERROR|STORY_MEDIA_EXPIRED|STORY_ALREADY_PUBLISHED|STORY_PUBLISH_FAILED|STORY_UPLOAD_FAILED|STORY_UNEXPECTED_RESPONSE)$/);
    return code ? code[0] : "STORY_PUBLISH_FAILED";
  }
  return "STORY_PUBLISH_FAILED";
}

async function graphRequest(
  token: string,
  endpoint: string,
  method: "GET" | "POST",
  values?: Record<string, string>,
): Promise<MetaReply> {
  const url = "https://graph.facebook.com/" + STORY_GRAPH_VERSION + "/" + endpoint;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/json",
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" } : {}),
    },
    ...(method === "POST" ? { body: new URLSearchParams(values).toString() } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await response.json().catch(() => null)) as MetaReply | null;
  if (!response.ok || !data || data.error) {
    const code = data?.error?.code;
    const subcode = data?.error?.error_subcode;
    throw new StoryMetaError(
      typeof code === "number"
        ? "STORY_META_ERROR_" + code + (typeof subcode === "number" ? "_" + subcode : "")
        : "STORY_PUBLISH_FAILED",
    );
  }
  return data;
}

/** Facebook Pages: stage an unpublished Page photo and publish it as a Story. */
export async function publishFacebookPhotoStory(
  pageId: string,
  pageToken: string,
  imageUrl: string,
): Promise<string> {
  const staged = await graphRequest(pageToken, pageId + "/photos", "POST", {
    url: imageUrl,
    published: "false",
  });
  if (!staged.id || !/^\d+$/.test(staged.id)) {
    throw new StoryMetaError("STORY_UPLOAD_FAILED");
  }
  const result = await graphRequest(pageToken, pageId + "/photo_stories", "POST", {
    photo_id: staged.id,
  });
  if (result.success !== true || !result.post_id) {
    throw new StoryMetaError("STORY_UNEXPECTED_RESPONSE");
  }
  return result.post_id;
}

/**
 * Instagram Business / Unified Login (graph.facebook.com). No sticker,
 * clickable link or automatic republish is supported by this integration.
 * A media container may need processing; never publish until FINISHED.
 */
export async function publishInstagramPhotoStory(
  instagramId: string,
  instagramToken: string,
  imageUrl: string,
  // Injectable delay only for deterministic unit tests; production waits
  // between read-only status requests on the *same* container.
  waitBetweenChecks: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<string> {
  const staged = await graphRequest(instagramToken, instagramId + "/media", "POST", {
    media_type: "STORIES",
    image_url: imageUrl,
  });
  if (!staged.id || !/^\d+$/.test(staged.id)) {
    throw new StoryMetaError("STORY_UPLOAD_FAILED");
  }
  // Meta processes image containers asynchronously, including image Stories.
  // Never issue media_publish while IN_PROGRESS or blindly recreate a container.
  // Check immediately, then up to five more times, four seconds apart (<=20s wait).
  const maxChecks = 6;
  let isReady = false;
  for (let check = 0; check < maxChecks; check++) {
    if (check > 0) await waitBetweenChecks(4_000);
    const state = await graphRequest(instagramToken, staged.id + "?fields=status_code", "GET");
    if (state.status_code === "FINISHED") {
      isReady = true;
      break;
    }
    if (state.status_code === "ERROR") {
      throw new StoryMetaError("STORY_MEDIA_PROCESSING_ERROR");
    }
    if (state.status_code === "EXPIRED") {
      throw new StoryMetaError("STORY_MEDIA_EXPIRED");
    }
    if (state.status_code === "PUBLISHED") {
      // Unknown prior publication: never send media_publish a second time.
      throw new StoryMetaError("STORY_ALREADY_PUBLISHED");
    }
    if (state.status_code !== "IN_PROGRESS") {
      throw new StoryMetaError("STORY_UNEXPECTED_RESPONSE");
    }
  }
  if (!isReady) {
    // No publish request was made; the existing container may still finish later.
    throw new StoryMetaError("STORY_NOT_READY");
  }
  // Exactly one publish request, and only after FINISHED.
  const result = await graphRequest(instagramToken, instagramId + "/media_publish", "POST", {
    creation_id: staged.id,
  });
  if (!result.id || !/^\d+$/.test(result.id)) {
    throw new StoryMetaError("STORY_UNEXPECTED_RESPONSE");
  }
  return result.id;
}
