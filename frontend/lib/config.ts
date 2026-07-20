/**
 * Single source of truth for the backend location.
 * Reads the NEXT_PUBLIC_* vars from .env.local (inlined at build time by Next.js),
 * falling back to localhost so a fresh clone still works with zero configuration.
 */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8100";

export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8100/ws";
