/** Select the token used for Instagram identity verification, never for publishing. */
export type InstagramVerificationEnv = {
  META_INSTAGRAM_ACCESS_TOKEN?: string;
  META_INSTAGRAM_ACCESS_TOKEN_NEXT?: string;
};

export type InstagramVerificationSource = "current" | "next";

/**
 * Explicit token separation: candidate checks never fall back to the old
 * token, and the existing Instagram verification stays on its original token.
 */
export function instagramVerificationToken(
  env: InstagramVerificationEnv,
  source: InstagramVerificationSource = "current",
): string {
  return (source === "next"
    ? env.META_INSTAGRAM_ACCESS_TOKEN_NEXT
    : env.META_INSTAGRAM_ACCESS_TOKEN)?.trim() ?? "";
}
