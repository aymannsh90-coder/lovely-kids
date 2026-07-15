import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import * as schema from "@workspace/db/schema";

export interface Env {
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
