import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifyToken } from './auth';
import type { VerifiedSession } from './auth';
import type { MongoClient } from 'mongodb';
import { loadStations } from './stationRepository';
import { canViewStation } from './stationAccess';
import { sessionStillValid } from './users';

/**
 * Verified session for an API request. Besides the signature/expiry check the
 * user record is re-read (cached 30 s), so disabling a user, changing their
 * role or customer, or deleting them logs them out of every API within ~30 s.
 */
export async function getRequestSession(req: NextRequest): Promise<VerifiedSession | null> {
  const session = await verifyToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  try {
    return (await sessionStillValid(session)) ? session : null;
  } catch (err: any) {
    console.error('[auth] user re-validation failed:', err?.message || err);
    return null;   // fail closed if the user store is unreachable
  }
}

/** null means unrestricted; an empty list must still restrict queries. */
export async function visibleStationIds(session: VerifiedSession, client: MongoClient): Promise<string[] | null> {
  if (session.role === 'admin') return null;
  return (await loadStations(client)).filter(station => canViewStation(session, station)).map(station => station.id);
}

/** Admin-only gate for mutation endpoints (checked here as well as in the proxy). */
export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'This account has read-only access' }, { status: 403 });
  return null;
}

/** @deprecated use requireAdmin */
export const requireEditor = requireAdmin;
