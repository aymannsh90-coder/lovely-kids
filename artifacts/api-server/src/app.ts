import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));


app.get("/", (_req, res) => {
  res.status(200).json({ ok: true, service: "Lovely Kids API" });
});

app.get("/api/health", (_req, res) => {
  const databaseUrl =
    process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;

  if (!databaseUrl) {
    res.status(500).json({
      ok: false,
      error: "DATABASE_URL missing",
    });
    return;
  }

  try {
    const url = new URL(databaseUrl);
    res.status(200).json({
      ok: true,
      database: {
        host: url.hostname,
        port: url.port,
        db: url.pathname,
      },
      clerk: {
        hasPublishableKey: Boolean(process.env.CLERK_PUBLISHABLE_KEY),
        hasSecretKey: Boolean(process.env.CLERK_SECRET_KEY),
      },
    });
  } catch {
    res.status(500).json({
      ok: false,
      error: "Invalid DATABASE_URL",
    });
  }
});

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

export default app;
