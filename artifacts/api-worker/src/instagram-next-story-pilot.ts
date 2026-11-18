/**
 * Strictly isolated Instagram Story pilot:
 * - uses NEXT token only, NEVER the old token or Facebook token
 * - does not borrow feed, carousel, or legacy Stories rollout flags
 * - only one product per test publication
 */
export type InstagramNextStoryPilotEnv = {
  META_INSTAGRAM_ACCOUNT_ID?: string;
  META_INSTAGRAM_ACCESS_TOKEN_NEXT?: string;
  META_INSTAGRAM_STORIES_NEXT_PILOT_ENABLED?: string;
};

export function instagramNextStoryPilotReady(env: InstagramNextStoryPilotEnv): boolean {
  return env.META_INSTAGRAM_STORIES_NEXT_PILOT_ENABLED?.trim() === "true" &&
    /^\d+$/.test(env.META_INSTAGRAM_ACCOUNT_ID?.trim() ?? "") &&
    !!env.META_INSTAGRAM_ACCESS_TOKEN_NEXT?.trim();
}

export function validateInstagramNextStoryProductId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function validInstagramStoryPhotoUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !!url.hostname &&
      !url.username && !url.password &&
      /\.jpe?g$/i.test(url.pathname);
  } catch {
    return false;
  }
}
