/**
 * Runs once when the Next.js server starts.
 * Starts the vSECC Manager Log collector (see lib/vseccStore.ts) in the same
 * process as the API routes, so it shares the ZeroTier one-network-at-a-time queue.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startVseccCollector } = await import('./lib/vseccStore');
  startVseccCollector();
}
