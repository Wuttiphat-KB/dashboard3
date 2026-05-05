'use client';

import { useState, useEffect } from 'react';
import Sidebar from './Sidebar';

const SIDEBAR_W     = 220;
const SIDEBAR_W_COL = 52;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed,   setCollapsed]   = useState(false);
  const [theme,       setTheme]       = useState<'dark' | 'light'>('dark');

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

  const sideW = collapsed ? SIDEBAR_W_COL : SIDEBAR_W;

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
