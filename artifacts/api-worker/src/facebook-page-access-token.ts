/** Resolve the Page token for Meta Page calls without exposing stored credentials. */
export type FacebookPageTokenEnv = {
  META_FACEBOOK_PAGE_ID?: string;
  META_FACEBOOK_PAGE_ACCESS_TOKEN?: string;
  META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN?: string;
};

type SystemPagesResponse = {
  data?: Array<{ id?: string; access_token?: string }>;
  error?: { code?: number; error_subcode?: number };
};

/**
 * Prefer the business system user's non-expiring token. Meta documents
 * GET /me/accounts for deriving a Page access token from a system user token.
 * Keep the former Page token as a migration fallback ONLY when no system token
 * is configured. Do not downgrade on a failed system-token request.
 */
export async function resolveFacebookPageAccessToken(
  env: FacebookPageTokenEnv,
): Promise<string> {
  const pageId = env.META_FACEBOOK_PAGE_ID?.trim() ?? "";
  if (!/^\d+$/.test(pageId)) throw new Error("FACEBOOK_NOT_CONFIGURED");

  const systemToken = env.META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN?.trim();
  if (!systemToken) {
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
