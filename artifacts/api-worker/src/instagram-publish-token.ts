/**
 * Instagram feed and Stories have separate, explicit rollouts.
 * Neither surface can borrow Facebook tokens or silently downgrade when NEXT is selected.
 */
export type InstagramPublishEnv = {
  META_INSTAGRAM_ACCESS_TOKEN?: string;
  META_INSTAGRAM_ACCESS_TOKEN_NEXT?: string;
  META_INSTAGRAM_FEED_USE_NEXT_TOKEN?: string;
  META_INSTAGRAM_STORIES_USE_NEXT_TOKEN?: string;
};
export type InstagramPublishSurface = "feed" | "stories";

export function instagramPublishUsesNextToken(
  env: InstagramPublishEnv,
  surface: InstagramPublishSurface,
): boolean {
  const value = surface === "feed"
    ? env.META_INSTAGRAM_FEED_USE_NEXT_TOKEN
    : env.META_INSTAGRAM_STORIES_USE_NEXT_TOKEN;
  return value?.trim() === "true";
}

/** A new feed route is NEVER allowed to publish with the legacy token. */
export function instagramFeedPilotReady(
  env: InstagramPublishEnv & { META_INSTAGRAM_ACCOUNT_ID?: string },
): boolean {
  const id = env.META_INSTAGRAM_ACCOUNT_ID?.trim() ?? "";
  return /^\d+$/.test(id) &&
    instagramPublishUsesNextToken(env, "feed") &&
    !!env.META_INSTAGRAM_ACCESS_TOKEN_NEXT?.trim();
}

/** No fallback in either direction. Feed route requires explicit NEXT opt-in to publish. */
export function instagramPublishingToken(
  env: InstagramPublishEnv,
  surface: InstagramPublishSurface,
): string {
  const raw = instagramPublishUsesNextToken(env, surface)
    ? env.META_INSTAGRAM_ACCESS_TOKEN_NEXT
    : env.META_INSTAGRAM_ACCESS_TOKEN;
  return raw?.trim() ?? "";
}
