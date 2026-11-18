/** Resolve the Page token for Meta Page calls without exposing stored credentials. */
export type FacebookPageTokenEnv = {
  META_FACEBOOK_PAGE_ID?: string;
  META_FACEBOOK_PAGE_ACCESS_TOKEN?: string;
  META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN?: string;
  META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN_NEXT?: string;
  META_FACEBOOK_POSTS_USE_NEXT_TOKEN?: string;
};

export type FacebookPageTokenSource = "current" | "next";

/** Default OFF: only Facebook feed posts can opt into the new system token. */
export function facebookPostsUseNextToken(env: FacebookPageTokenEnv): boolean {
  return env.META_FACEBOOK_POSTS_USE_NEXT_TOKEN?.trim() === "true";
}

type SystemPagesResponse = {
  data?: Array<{ id?: string; access_token?: string }>;
  error?: { code?: number; error_subcode?: number };
};

/**
 * Prefer the business system user's non-expiring token. Meta documents
 * GET /me/accounts for deriving a Page access token from a system user token.
 * The NEXT token is opt-in and never falls back to the old system or legacy Page token.
 * For current mode, keep the legacy Page-token fallback ONLY if no system token
 * is configured. Never downgrade after a failed system-token request.
 */
export async function resolveFacebookPageAccessToken(
  env: FacebookPageTokenEnv,
  source: FacebookPageTokenSource = "current",
): Promise<string> {
  const pageId = env.META_FACEBOOK_PAGE_ID?.trim() ?? "";
  if (!/^\d+$/.test(pageId)) throw new Error("FACEBOOK_NOT_CONFIGURED");

  const systemToken = (source === "next"
    ? env.META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN_NEXT
    : env.META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN)?.trim();
  if (!systemToken) {
    if (source === "next") throw new Error("FACEBOOK_NOT_CONFIGURED");
    const legacyPageToken = env.META_FACEBOOK_PAGE_ACCESS_TOKEN?.trim();
    if (!legacyPageToken) throw new Error("FACEBOOK_NOT_CONFIGURED");
    return legacyPageToken;
  }

  const response = await fetch(
    "https://graph.facebook.com/v27.0/me/accounts?fields=id,access_token&limit=100",
    {
      method: "GET",
      headers: { Authorization: "Bearer " + systemToken, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    },
  );
  const data = (await response.json().catch(() => null)) as SystemPagesResponse | null;
  if (!response.ok || !data || data.error || !Array.isArray(data.data)) {
    const code = data?.error?.code;
    const subcode = data?.error?.error_subcode;
    const detail = typeof code === "number"
      ? "_" + code + (typeof subcode === "number" ? "_" + subcode : "")
      : "_HTTP_" + response.status;
    throw new Error("FACEBOOK_SYSTEM_TOKEN_FAILED" + detail);
  }

  const pageToken = data.data.find((page) => page.id === pageId)?.access_token?.trim();
  if (!pageToken) throw new Error("FACEBOOK_SYSTEM_PAGE_NOT_FOUND");
  return pageToken;
}

/** Posts can migrate independently; Facebook Stories keep their existing token. */
export function resolveFacebookPostPageAccessToken(env: FacebookPageTokenEnv): Promise<string> {
  return resolveFacebookPageAccessToken(env, facebookPostsUseNextToken(env) ? "next" : "current");
}
