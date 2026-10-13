'use client';

import { createContext, useContext, useEffect, useState } from 'react';

interface SessionAccess {
  username: string | null;
  canEdit: boolean;
  loading: boolean;
}

const SessionContext = createContext<SessionAccess>({ username: null, canEdit: false, loading: true });

export function useSessionAccess() {
  return useContext(SessionContext);
}

export default function SessionProvider({ children }: { children: React.ReactNode }) {
  const [access, setAccess] = useState<SessionAccess>({ username: null, canEdit: false, loading: true });
  useEffect(() => {
    let active = true;
    fetch('/api/auth/session', { cache: 'no-store' })
      .then(async res => res.ok ? res.json() : null)
      .then(session => {
        if (active) setAccess({ username: session?.username ?? null, canEdit: session?.role === 'admin', loading: false });
      })
      .catch(() => {
        if (active) setAccess({ username: null, canEdit: false, loading: false });
      });
    return () => { active = false; };
  }, []);
  return <SessionContext.Provider value={access}>{children}</SessionContext.Provider>;
}
