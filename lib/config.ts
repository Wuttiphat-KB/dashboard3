/**
 * Runtime config for browser — resolves hostname dynamically so the same
 * build works on localhost, LAN, or production server without rebuilding.
 *
 * NEXT_PUBLIC_* env vars are baked into the JS bundle at build time, which
 * means hardcoding `localhost` in .env.local breaks remote access.
 *
 * Optional override: set NEXT_PUBLIC_WS_URL / NEXT_PUBLIC_API_URL only when
 * you need a fixed hostname (e.g. behind nginx with HTTPS at a different
 * domain). Otherwise leave unset and these helpers auto-detect.
 */

const WS_PORT  = '4100';

function getHost(): string {
  if (typeof window === 'undefined') return 'localhost';
  return window.location.hostname || 'localhost';
}

function getProto(): { http: string; ws: string } {
  if (typeof window === 'undefined') return { http: 'http:', ws: 'ws:' };
  const isHttps = window.location.protocol === 'https:';
  return { http: isHttps ? 'https:' : 'http:', ws: isHttps ? 'wss:' : 'ws:' };
}

/** WebSocket URL — auto-detects host, or uses NEXT_PUBLIC_WS_URL if explicitly set */
export function getWsUrl(): string {
  const override = process.env.NEXT_PUBLIC_WS_URL;
  if (override) return override;
  const { ws } = getProto();
  return `${ws}//${getHost()}:${WS_PORT}`;
}

/** API base URL — same-origin by default (Next.js serves /api on same host) */
export function getApiUrl(): string {
  const override = process.env.NEXT_PUBLIC_API_URL;
  if (override) return override;
  return '/api';   // same-origin — works regardless of host/port
}
