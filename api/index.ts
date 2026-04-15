/**
 * api/index.ts
 *
 * Vercel serverless entry point.
 * Vercel auto-detects files in /api/ as serverless functions.
 * We re-export the Express app so Vercel uses it as the request handler.
 *
 * Static files (index.html) are served by Vercel natively from /public/.
 */

import app from "../ui/server.js";

export default app;
