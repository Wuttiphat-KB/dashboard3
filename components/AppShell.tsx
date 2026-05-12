'use client';

import { useState, useEffect, useCallback } from 'react';
import Sidebar from './Sidebar';
import { useWebSocket, WsMessage } from '@/lib/hooks/useWebSocket';
import { invalidateFleet, invalidateDashboard } from '@/lib/hooks/dataCache';

const SIDEBAR_W     = 220;
const SIDEBAR_W_COL = 52;
const MOBILE_BREAKPOINT = 768;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed,   setCollapsed]   = useState(false);
  const [theme,       setTheme]       = useState<'dark' | 'light'>('dark');
  const [isMobile,    setIsMobile]    = useState(false);

  // Track mobile breakpoint
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Load saved theme on mount
  useEffect(() => {
    const saved = localStorage.getItem('ev-theme') as 'dark' | 'light' | null;
    const initial = saved ?? 'dark';
    setTheme(initial);
    document.documentElement.setAttribute('data-theme', initial);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('ev-theme', next);
  };

  // WebSocket bridge — invalidate caches when realtime events arrive
  const onWsMessage = useCallback((msg: WsMessage) => {
    // Data-affecting events trigger cache refresh (throttled inside dataCache)
    const dataTypes = ['heartbeat', 'meter', 'powerModule', 'plc', 'temperature', 'fanRpm', 'scriptHb', 'alert'];
    if (dataTypes.includes(msg.type)) {
      invalidateFleet();
      if (msg.stationId) invalidateDashboard(msg.stationId);
    }
  }, []);
  useWebSocket(onWsMessage);

  // On mobile, sidebar is overlay → main content has no left margin
  const sideW = isMobile ? 0 : (collapsed ? SIDEBAR_W_COL : SIDEBAR_W);

  return (
    <div className="app-layout">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(c => !c)}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <div className="main-content" style={{ marginLeft: sideW }}>
        {/* Mobile topbar */}
        <div className="topbar">
          <button
            onClick={() => setSidebarOpen(o => !o)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-primary)', fontSize: 20, padding: 4,
              display: 'flex', alignItems: 'center',
            }}
            aria-label="Toggle menu"
          >
            ☰
          </button>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>EV Monitor</span>
        </div>

        <div className="page-container">
          {children}
        </div>
      </div>
    </div>
  );
}
