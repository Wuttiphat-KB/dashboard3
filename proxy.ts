import { NextResponse, type NextRequest } from 'next/server';
import { verifyToken, SESSION_COOKIE } from './lib/auth';

/**
 * Site-wide auth gate.
 *   - Allows /login and login / logout endpoints through unauthenticated.
 *   - Allows static assets through (handled by `matcher` below).
 *   - For unauthenticated /api/* calls → 401 JSON.
 *   - For unauthenticated page navigations → redirect to /login with ?from=.
 *
 * Verifies signed sessions and blocks viewer mutations; endpoints also enforce
 * permissions independently before changing data.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public routes — never gated.
  if (
    pathname === '/login' ||
    pathname === '/api/auth/login' || pathname === '/api/auth/logout'
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifyToken(token);
  if (session) {
    if (session.role === 'viewer') {
      if (['/config', '/settings'].some(path => pathname === path || pathname.startsWith(path + '/'))) {
        return NextResponse.redirect(new URL('/', req.url));
      }
      if (pathname.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return NextResponse.json({ error: 'This account has read-only access' }, { status: 403 });
      }
    }
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
