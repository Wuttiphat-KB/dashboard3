/**
 * Centralized env config for both frontend API routes and backend.
 * Throws at startup if MONGO_URI is missing — no hardcoded fallback.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}. Set it in .env.local`);
  return v;
}

export const MONGO_URI = required('MONGO_URI');
