import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifyToken } from './auth';
import type { VerifiedSession } from './auth';
import type { MongoClient } from 'mongodb';
import { loadStations } from './stationRepository';
import { canViewStation } from './stationAccess';

export function getRequestSession(req: NextRequest) {
  return verifyToken(req.cookies.get(SESSION_COOKIE)?.value);
}

/** null means unrestricted; an empty list must still restrict queries. */
export async function visibleStationIds(session: VerifiedSession, client: MongoClient): Promise<string[] | null> {
  if (session.role === 'admin') return null;
  return (await loadStations(client)).filter(station => canViewStation(session, station)).map(station => station.id);
}

/** Check at each mutation endpoint as well as at the site-wide auth gate. */
export async function requireEditor(req: NextRequest): Promise<NextResponse | null> {
  const session = await getRequestSession(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'This account has read-only access' }, { status: 403 });
  return null;
}
