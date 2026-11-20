import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import * as schema from "@workspace/db/schema";

export interface Env {
  CLERK_SECRET_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  RESEND_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  IMAGE_STORAGE_PROVIDER?: "supabase" | "r2";
  R2_BUCKET?: R2Bucket;
  POS_PURCHASE_API_ENABLED?: string;
  POS_PURCHASE_WRITES_ENABLED?: string;
  /** Remains disabled until real-bank and supplier clearing integration is verified. */
  POS_IMPORT_FINANCIAL_POSTING_ENABLED?: string;
  /** Independent owner-only close/reverse flag; OFF in deployed environments. */
  POS_IMPORT_CLOSING_ENABLED?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  ORDER_TRACKING_SECRET?: string;
  META_CAPI_ACCESS_TOKEN?: string;
  META_FACEBOOK_PAGE_ID?: string;
  META_FACEBOOK_PAGE_ACCESS_TOKEN?: string;
  META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN?: string;
  META_FACEBOOK_SYSTEM_USER_ACCESS_TOKEN_NEXT?: string;
  /** Opt in ONLY Facebook feed posts to the new system token; default disabled. */
  META_FACEBOOK_POSTS_USE_NEXT_TOKEN?: string;
  /** Independent opt-in for owner-only Facebook NEXT Stories (default OFF). */
  META_FACEBOOK_STORIES_NEXT_PILOT_ENABLED?: string;
  META_INSTAGRAM_ACCOUNT_ID?: string;
  META_INSTAGRAM_ACCESS_TOKEN?: string;
  /** Candidate Instagram token: read-only by default, usable for publishing only by explicit opt-in. */
  META_INSTAGRAM_ACCESS_TOKEN_NEXT?: string;
  /** Independent opt-in for Instagram feed single-photo publishing (default OFF). */
  META_INSTAGRAM_FEED_USE_NEXT_TOKEN?: string;
  /** Independent opt-in for Instagram Stories publishing (default OFF). */
  META_INSTAGRAM_STORIES_USE_NEXT_TOKEN?: string;
  /** Independently gated owner-only NEXT Instagram Story pilot (default OFF); never uses legacy token. */
  META_INSTAGRAM_STORIES_NEXT_PILOT_ENABLED?: string;
  /** Separately gated Instagram Carousel 2–10 photos (default OFF). */
  META_INSTAGRAM_CAROUSEL_ENABLED?: string;
  HYPERDRIVE: {
    connectionString: string;
  };
}

export async function openDb(env: Env) {
  const client = new Client({
    connectionString: env.HYPERDRIVE.connectionString,
    // Bound connection setup only; long financial reports keep their existing query time.
    connectionTimeoutMillis: 10_000,
  });

  await client.connect();

  return {
    client,
    db: drizzle(client, { schema }),
  };
}
