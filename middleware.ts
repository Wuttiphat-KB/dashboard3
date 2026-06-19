import { NextResponse, type NextRequest } from 'next/server';
import { verifyToken, SESSION_COOKIE } from './lib/auth';

/**
 * Site-wide auth gate.
 *   - Allows /login + /api/auth/* (login / logout) through unauthenticated.
 *   - Allows static assets through (handled by `matcher` below).
 *   - For unauthenticated /api/* calls → 401 JSON.
 *   - For unauthenticated page navigations → redirect to /login with ?from=.
 *
 * Runs on the Edge runtime by default, so it uses Web Crypto inside
 * `verifyToken` (no Node `crypto` import).
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public routes — never gated.
  if (
    pathname === '/login' ||
    pathname.startsWith('/api/auth/')
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifyToken(token);
  if (session) {
    return NextResponse.next();
  }

  // Unauthenticated — branch on API vs page.
  if (pathname.startsWith('/api/')) {
    return new NextResponse(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  if (pathname !== '/') url.searchParams.set('from', pathname);
  else url.searchParams.delete('from');
  return NextResponse.redirect(url);
}

// Skip static assets — matcher uses negative-lookahead on Next internals
// and a short allow-list of asset filenames in /public.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|flexxfast-logo\\.png|.*\\.svg$).*)',
  ],
};
