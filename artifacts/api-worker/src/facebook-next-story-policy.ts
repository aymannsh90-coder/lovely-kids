/**
 * Facebook NEXT Stories have their own opt-in and must never inherit
 * Facebook feed, Instagram, or legacy Story publishing flags.
 */
export type FacebookNextStoriesEnv = {
  META_FACEBOOK_PAGE_ID?: string;
  META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN_NEXT?: string;
  META_FACEBOOK_STORIES_NEXT_PILOT_ENABLED?: string;
};

export function facebookNextStoryPilotReady(env: FacebookNextStoriesEnv): boolean {
  return env.META_FACEBOOK_STORIES_NEXT_PILOT_ENABLED?.trim() === "true" &&
    /^\d+$/.test(env.META_FACEBOOK_PAGE_ID?.trim() ?? "") &&
    !!env.META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN_NEXT?.trim();
}

export function facebookNextStoryProductId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function validFacebookNextStoryImage(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !!url.hostname &&
      !url.username && !url.password &&
      /\.(?:jpe?g|png)$/i.test(url.pathname);
  } catch {
    return false;
  }
}
