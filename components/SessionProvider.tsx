'use client';

import { createContext, useContext, useEffect, useState } from 'react';

export type SessionRole = 'admin' | 'customer';

interface SessionAccess {
  username: string | null;
  role: SessionRole | null;
  customer: string | null;
  /** true for admin — kept as `canEdit` because many pages already use it */
  canEdit: boolean;
  isAdmin: boolean;
  loading: boolean;
}

const EMPTY: SessionAccess = { username: null, role: null, customer: null, canEdit: false, isAdmin: false, loading: true };
const SessionContext = createContext<SessionAccess>(EMPTY);

export function useSessionAccess() {
  return useContext(SessionContext);
}

export default function SessionProvider({ children }: { children: React.ReactNode }) {
  const [access, setAccess] = useState<SessionAccess>(EMPTY);
  useEffect(() => {
    let active = true;
    fetch('/api/auth/session', { cache: 'no-store' })
      .then(async res => res.ok ? res.json() : null)
      .then(session => {
        if (!active) return;
        const isAdmin = session?.role === 'admin';
        setAccess({
          username: session?.username ?? null,
          role: session?.role ?? null,
          customer: session?.customer ?? null,
          canEdit: isAdmin, isAdmin, loading: false,
        });
      })
      .catch(() => {
        if (active) setAccess({ ...EMPTY, loading: false });
      });
    return () => { active = false; };
  }, []);
  return <SessionContext.Provider value={access}>{children}</SessionContext.Provider>;
}
