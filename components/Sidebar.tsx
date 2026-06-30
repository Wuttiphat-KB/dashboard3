'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SIDEBAR_W     = 220;
const SIDEBAR_W_COL = 52;

const NAV_MAIN = [
  { href: '/',         label: 'Overview',        abbr: 'OV' },
  { href: '/alerts',   label: 'Alert Center',    abbr: 'AL' },
  { href: '/config',   label: 'Station Config',  abbr: 'SC' },
  { href: '/settings', label: 'Settings',        abbr: 'ST' },
];

const NAV_STATS = [
  { href: '/statistics/energy', label: 'Energy Usage', abbr: 'EU' },
];

const NAV_OVERVIEW = [
  { href: '/map',                  label: 'Station Map',   abbr: 'MP' },
  { href: '/overview/heartbeat',   label: 'Heartbeat',     abbr: 'HB' },
  { href: '/overview/powermodule', label: 'Power Module',  abbr: 'PM' },
  { href: '/overview/meter',       label: 'Meter',         abbr: 'MT' },
  { href: '/overview/temperature', label: 'Temperature',   abbr: 'TM' },
  { href: '/overview/fanrpm',      label: 'Fan RPM',       abbr: 'FN' },
  { href: '/overview/device',      label: 'Device Status', abbr: 'DV' },
  { href: '/overview/scripts',     label: 'MQTT Scripts',  abbr: 'MQ' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

function NavLink({ href, label, abbr, isActive, onClick, collapsed }: {
  href: string; label: string; abbr: string;
  isActive: boolean; onClick: () => void; collapsed: boolean;
}) {
  if (collapsed) {
    return (
      <Link
        href={href}
        onClick={onClick}
        title={label}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 36,
          borderRadius: 6,
          marginBottom: 2,
          textDecoration: 'none',
          background: isActive ? 'var(--info-bg)' : 'transparent',
          transition: 'background 0.15s',
        }}
      >
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          color: isActive ? 'var(--info-text)' : 'var(--text-muted)',
          letterSpacing: '0.04em',
        }}>
          {abbr}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 500,
        color: isActive ? 'var(--info-text)' : 'var(--text-secondary)',
        background: isActive ? 'var(--info-bg)' : 'transparent',
        textDecoration: 'none',
        marginBottom: 1,
        transition: 'all 0.15s',
      }}
    >
      <div style={{
        width: 3, height: 14, borderRadius: 2, flexShrink: 0,
        background: isActive ? 'var(--info)' : 'var(--border)',
        transition: 'background 0.15s',
      }} />
      {label}
    </Link>
  );
}

export default function Sidebar({ open, onClose, collapsed, onToggleCollapse, theme, onToggleTheme }: Props) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(href + '/');
  };

  return (
    <>
      {/* Overlay (mobile) */}
      <div
        className={open ? 'sidebar-overlay sidebar-overlay-visible' : 'sidebar-overlay'}
        onClick={onClose}
      />

      <aside
        className={`sidebar ${open ? 'sidebar-open' : ''}`}
        style={{ width: collapsed ? SIDEBAR_W_COL : SIDEBAR_W }}
      >
        {/* Logo + collapse toggle */}
        <div style={{
          padding: collapsed ? '14px 0' : '14px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          gap: 10,
          flexShrink: 0,
          minHeight: 57,
        }}>
          {collapsed ? (
            /* Collapsed: small square icon, click to expand */
            <button
              onClick={onToggleCollapse}
              title="Expand sidebar"
              style={{
                width: 36, height: 36, borderRadius: 6,
                background: 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', cursor: 'pointer', flexShrink: 0,
                padding: 0,
              }}
            >
              <img
                src="/flexxfast-logo.png"
                alt="FlexxFast"
                style={{ width: 32, height: 32, objectFit: 'contain' }}
              />
            </button>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <img
                  src="/flexxfast-logo.png"
                  alt="FlexxFast by EDS"
                  style={{
                    height: 38,
                    width: 'auto',
                    maxWidth: 160,
                    objectFit: 'contain',
                    flexShrink: 0,
                  }}
                />
              </div>
              {/* Collapse button */}
              <button
                onClick={onToggleCollapse}
                title="Collapse sidebar"
                style={{
                  background: 'none', border: '1px solid var(--border)',
                  borderRadius: 4, cursor: 'pointer', padding: '2px 6px',
                  color: 'var(--text-muted)', fontSize: 11, flexShrink: 0,
                  lineHeight: 1.4,
                }}
              >
                «
              </button>
            </>
          )}
        </div>

        {/* Nav */}
        <nav style={{ padding: collapsed ? '10px 4px' : '10px 8px', flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {/* Section label */}
          {!collapsed && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 12px 6px', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
              Navigation
            </div>
          )}
          {collapsed && <div style={{ height: 4 }} />}

          {NAV_MAIN.map(({ href, label, abbr }) => (
            <NavLink
              key={href}
              href={href} label={label} abbr={abbr}
              isActive={isActive(href)}
              onClick={onClose}
              collapsed={collapsed}
            />
          ))}

          {/* Divider */}
          <div style={{ height: 1, background: 'var(--border-subtle)', margin: collapsed ? '8px 6px' : '10px 4px' }} />

          {/* Statistics links */}
          {!collapsed && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 12px 6px', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
              Statistics
            </div>
          )}

          {NAV_STATS.map(({ href, label, abbr }) => (
            <NavLink
              key={href}
              href={href} label={label} abbr={abbr}
              isActive={isActive(href)}
              onClick={onClose}
              collapsed={collapsed}
            />
          ))}

          {/* Divider */}
          <div style={{ height: 1, background: 'var(--border-subtle)', margin: collapsed ? '8px 6px' : '10px 4px' }} />

          {/* System Overview links */}
          {!collapsed && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 12px 6px', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
              System Overview
            </div>
          )}

          {NAV_OVERVIEW.map(({ href, label, abbr }) => (
            <NavLink
              key={href}
              href={href} label={label} abbr={abbr}
              isActive={isActive(href)}
              onClick={onClose}
              collapsed={collapsed}
            />
          ))}
        </nav>

        {/* Footer */}
        {!collapsed && (
          <div style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}>
            {/* Theme toggle */}
            <button
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              style={{
                width: '100%', marginBottom: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '6px 10px', borderRadius: 6,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                cursor: 'pointer', color: 'var(--text-secondary)',
                fontSize: 11, fontFamily: 'var(--font-geist-mono), monospace',
                transition: 'all 0.15s',
              }}
            >
              <span>{theme === 'dark' ? '◑ Dark Mode' : '○ Light Mode'}</span>
              <span style={{
                fontSize: 9, padding: '1px 6px', borderRadius: 10,
                background: theme === 'dark' ? 'var(--info-bg)' : 'var(--warn-bg)',
                color: theme === 'dark' ? 'var(--info-text)' : 'var(--warn-text)',
                fontWeight: 700, letterSpacing: '0.04em',
              }}>
                {theme === 'dark' ? 'DARK' : 'LIGHT'}
              </span>
            </button>

            {/* Logout */}
            <button
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
                window.location.href = '/login';
              }}
              title="Sign out"
              style={{
                width: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '6px 10px', borderRadius: 6,
                background: 'transparent', border: '1px solid var(--border)',
                cursor: 'pointer', color: 'var(--text-secondary)',
                fontSize: 11, fontFamily: 'var(--font-geist-mono), monospace',
              }}
            >
              ⎋ Logout
            </button>
          </div>
        )}

        {/* Collapsed footer: theme toggle + expand */}
        {collapsed && (
          <div style={{
            padding: '10px 0',
            borderTop: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            flexShrink: 0,
          }}>
            <button
              onClick={onToggleTheme}
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              style={{
                background: 'none', border: '1px solid var(--border)',
                borderRadius: 4, cursor: 'pointer', padding: '3px 7px',
                color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.4,
              }}
            >
              {theme === 'dark' ? '○' : '◑'}
            </button>
            <button
              onClick={onToggleCollapse}
              title="Expand sidebar"
              style={{
                background: 'none', border: '1px solid var(--border)',
                borderRadius: 4, cursor: 'pointer', padding: '3px 7px',
                color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.4,
              }}
            >
              »
            </button>
            <button
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
                window.location.href = '/login';
              }}
              title="Sign out"
              style={{
                background: 'none', border: '1px solid var(--border)',
                borderRadius: 4, cursor: 'pointer', padding: '3px 7px',
                color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.4,
              }}
            >
              ⎋
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
