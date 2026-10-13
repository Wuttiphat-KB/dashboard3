import type { VerifiedSession } from './auth';

export interface CustomerStation {
  customer?: { name?: string };
}

/** PTG is scoped to the exact customer name PT; unassigned stations are private. */
export function canViewStation(session: VerifiedSession, station: CustomerStation): boolean {
  return session.role === 'admin' || (session.username === 'PTG' && station.customer?.name?.trim() === 'PT');
}
