'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getOps } from '@/lib/ops/engine';
import '@/app/ops/ops.css';

/**
 * Hosts the Ops console views. The engine (lib/ops/engine.ts) draws into #view;
 * React only owns the static shell so it never re-renders over the engine's DOM.
 */
export default function OpsConsole({ view }: { view: string }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ops = getOps(v => router.push(`/ops/${v}`));
    if (ref.current) ops.mount(view, ref.current);
    return () => ops.unmount();
  }, [view, router]);

  return (
    <div className="ops" ref={ref}>
      <div className="ops-top">
        <h1 id="title">Overview</h1>
        <div className="scope" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label htmlFor="fCust">Customer</label><select id="fCust" />
          <label htmlFor="fSite">Site</label><select id="fSite" />
        </div>
        <div className="demo" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
          <span className="livedot" aria-hidden="true" /><span id="clock" />
        </div>
      </div>
      <div id="view" tabIndex={-1} />
      <div className="drawer" id="drawer" role="dialog" aria-modal="false" aria-labelledby="drawerTitle" />
    </div>
  );
}
