import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    DATABASE_URL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    AWS_ACCESS_KEY_ID: z.string(),
    AWS_SECRET_ACCESS_KEY: z.string(),
    AWS_REGION: z.string(),
    S3_BUCKET_NAME: z.string(),
    BACKEND_API_KEY: z.string(),
    STYLETTS2_API_ROUTE: z.string(),
    SEED_VC_API_ROUTE: z.string(),
    MAKE_AN_AUDIO_API_ROUTE: z.string(),
    // ---- 60db TTS (cloud) ----
    SIXTYDB_API_KEY: z.string(),
    SIXTYDB_API_BASE: z.string().default("https://api.60db.ai"),
    // Default provider used when the chosen voice is not bound to a specific
    // engine (e.g. a freshly imported voice). One of: styletts2 | 60db-sync.
    // Streaming / WebSocket modes are explicit endpoints; this default only
    // governs the Inngest async path.
    DEFAULT_TTS_PROVIDER: z
      .enum(["styletts2", "60db-sync"])
      .default("styletts2"),
    // ---- Sidecar WS proxy (port 3001 by default) ----
    // Used by the browser to reach the 60db realtime WS without leaking
    // SIXTYDB_API_KEY. The Next.js app mints a short-lived JWT signed with
    // WS_PROXY_SECRET; the sidecar verifies it and only then opens the
    // upstream connection to wss://api.60db.ai/ws/tts?apiKey=SIXTYDB_API_KEY.
    WS_PROXY_SECRET: z.string(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // Public URL the browser uses to reach the sidecar WS proxy. Defaults to
    // localhost in dev — override in deployed envs.
    NEXT_PUBLIC_WS_PROXY_URL: z.string().default("ws://localhost:3001/tts"),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    AUTH_SECRET: process.env.AUTH_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_REGION: process.env.AWS_REGION,
    S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
    BACKEND_API_KEY: process.env.BACKEND_API_KEY,
    STYLETTS2_API_ROUTE: process.env.STYLETTS2_API_ROUTE,
    SEED_VC_API_ROUTE: process.env.SEED_VC_API_ROUTE,
    MAKE_AN_AUDIO_API_ROUTE: process.env.MAKE_AN_AUDIO_API_ROUTE,
    SIXTYDB_API_KEY: process.env.SIXTYDB_API_KEY,
    SIXTYDB_API_BASE: process.env.SIXTYDB_API_BASE,
    DEFAULT_TTS_PROVIDER: process.env.DEFAULT_TTS_PROVIDER,
    WS_PROXY_SECRET: process.env.WS_PROXY_SECRET,
    NEXT_PUBLIC_WS_PROXY_URL: process.env.NEXT_PUBLIC_WS_PROXY_URL,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
