import { Client } from "pg";

interface Env {
  HYPERDRIVE: {
    connectionString: string;
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/api/health") {
      return Response.json(
        { ok: false, error: "Not found" },
        { status: 404 },
      );
    }

    const client = new Client({
      connectionString: env.HYPERDRIVE.connectionString,
    });

    try {
      await client.connect();
      await client.query("select 1");

      return Response.json({
        ok: true,
        service: "Lovely Kids Worker API",
        database: "connected",
      });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Database error",
        },
        { status: 500 },
      );
    } finally {
      await client.end().catch(() => {});
    }
  },
};
