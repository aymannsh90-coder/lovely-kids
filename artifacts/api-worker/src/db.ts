import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import * as schema from "@workspace/db/schema";

export interface Env {
  ADMIN_PROMOTE_PASSWORD?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
    SUPABASE_URL?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
  HYPERDRIVE: {
    connectionString: string;
  };
}

export async function openDb(env: Env) {
  const client = new Client({
    connectionString: env.HYPERDRIVE.connectionString,
  });

  await client.connect();

  return {
    client,
    db: drizzle(client, { schema }),
  };
}
