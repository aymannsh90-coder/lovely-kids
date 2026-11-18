/**
 * Publish exactly ONE Instagram feed photo using Facebook Login's Graph API.
 * Stages the container, checks FINISHED, then sends media_publish once.
 * No retries after uncertain outcomes; never log raw Meta responses or credentials.
 */
const GRAPH = "https://graph.facebook.com/v27.0/";
type Reply = {
  id?: string;
  permalink?: string;
  status_code?: string;
  error?: { code?: number; error_subcode?: number };
};
export class InstagramFeedError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "InstagramFeedError";
  }
}
export function safeInstagramFeedError(err: unknown): string {
  if (err instanceof InstagramFeedError &&
      /^IG_FEED_(?:META_\d+(?:_\d+)?|UPLOAD_FAILED|UNEXPECTED_RESPONSE|NOT_READY|MEDIA_ERROR|MEDIA_EXPIRED|ALREADY_PUBLISHED|API_FAILED)$/.test(err.message)) {
    return err.message;
  }
  return "IG_FEED_API_FAILED";
}
async function graph(
  token: string, endpoint: string, method: "GET" | "POST",
  params?: Record<string, string>,
): Promise<Reply> {
  const result = await fetch(GRAPH + endpoint, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/json",
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" } : {}),
    },
    ...(method === "POST" ? { body: new URLSearchParams(params).toString() } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await result.json().catch(() => null) as Reply | null;
  if (!result.ok || !data || data.error) {
    const code = data?.error?.code;
    const subcode = data?.error?.error_subcode;
    throw new InstagramFeedError(typeof code === "number"
      ? "IG_FEED_META_" + code + (typeof subcode === "number" ? "_" + subcode : "")
      : "IG_FEED_API_FAILED");
  }
  return data;
}

export async function publishInstagramSinglePhoto(
  accountId: string, accessToken: string, imageUrl: string, caption: string,
  wait: (ms: number) => Promise<void> = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<{ mediaId: string; permalink: string | null }> {
  if (!/^\d+$/.test(accountId) || !accessToken) throw new InstagramFeedError("IG_FEED_API_FAILED");
  const staged = await graph(accessToken, accountId + "/media", "POST", {
    image_url: imageUrl,
    caption,
  });
  if (!staged.id || !/^\d+$/.test(staged.id)) throw new InstagramFeedError("IG_FEED_UPLOAD_FAILED");
  let ready = false;
  for (let i = 0; i < 6; i++) {
    if (i > 0) await wait(4_000);
    const state = await graph(accessToken, staged.id + "?fields=status_code", "GET");
    if (state.status_code === "FINISHED") { ready = true; break; }
    if (state.status_code === "ERROR") throw new InstagramFeedError("IG_FEED_MEDIA_ERROR");
    if (state.status_code === "EXPIRED") throw new InstagramFeedError("IG_FEED_MEDIA_EXPIRED");
    if (state.status_code === "PUBLISHED") throw new InstagramFeedError("IG_FEED_ALREADY_PUBLISHED");
    if (state.status_code !== "IN_PROGRESS") throw new InstagramFeedError("IG_FEED_UNEXPECTED_RESPONSE");
  }
  if (!ready) throw new InstagramFeedError("IG_FEED_NOT_READY");
  const published = await graph(accessToken, accountId + "/media_publish", "POST", { creation_id: staged.id });
  if (!published.id || !/^\d+$/.test(published.id)) throw new InstagramFeedError("IG_FEED_UNEXPECTED_RESPONSE");
  // Permalink is optional; a failed read must NOT cause another publish attempt.
  try {
    const detail = await graph(accessToken, published.id + "?fields=permalink", "GET");
    if (typeof detail.permalink === "string" && /^https:\/\/www\.instagram\.com\//.test(detail.permalink)) {
      return { mediaId: published.id, permalink: detail.permalink };
    }
  } catch {}
  return { mediaId: published.id, permalink: null };
}
