import type { VerifiedSession } from './auth';

export interface CustomerStation {
  customer?: { name?: string };
}

/** Customer accounts see only stations whose customer.name equals their customer (exact, trimmed); unassigned stations stay private. */
export function canViewStation(session: Pick<VerifiedSession, 'role' | 'customer'>, station: CustomerStation): boolean {
  if (session.role === 'admin') return true;
  const mine = session.customer?.trim();
  return !!mine && station.customer?.name?.trim() === mine;
}
