import { createClerkClient } from "@clerk/backend";
import type { Env } from "./db";

export async function getClerkUserId(
  request: Request,
  env: Env,
) {
  if (
    !env.CLERK_SECRET_KEY ||
    !env.CLERK_PUBLISHABLE_KEY
  ) {
    return null;
  }

  const client = createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
  });

  const state = await client.authenticateRequest(request, {
    acceptsToken: "session_token",
  });

  if (!state.isAuthenticated) return null;

  return state.toAuth().userId ?? null;
}

export async function getClerkUser(
  userId: string,
  env: Env,
) {
  if (!env.CLERK_SECRET_KEY) return null;

  const client = createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
  });

  return client.users.getUser(userId);
}
