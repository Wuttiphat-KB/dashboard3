'use client';

import { useEffect, useRef, useState } from 'react';
import { copyText } from '@/lib/clipboard';

interface Props {
  /** Text placed on the clipboard when clicked. */
  value: string;
  /** Tooltip / aria-label — defaults to "Copy <value>". */
  title?: string;
  /** Icon box size in px (button is square). */
  size?: number;
}

/**
 * Copy-to-clipboard icon button. Stops the click from reaching a parent
 * Link / card so it can sit inside clickable station rows.
 */
export default function CopyButton({ value, title, size = 22 }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!value) return;
    const ok = await copyText(value);
    setState(ok ? 'copied' : 'failed');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1500);
  };

  const color =
    state === 'copied' ? 'var(--ok-text)'
    : state === 'failed' ? 'var(--error-text)'
    : 'var(--text-muted)';

  const label = title ?? `Copy ${value}`;

  return (
    <button
      type="button"
      onClick={copy}
      title={state === 'copied' ? 'Copied!' : state === 'failed' ? 'Copy failed' : label}
      aria-label={label}
      style={{
        width: size, height: size,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        verticalAlign: 'middle', flexShrink: 0,
        background: state === 'copied' ? 'var(--ok-bg)' : 'transparent',
        border: '1px solid',
        borderColor: state === 'copied' ? 'var(--ok)' : 'var(--border)',
        borderRadius: 'var(--radius-sm)',
        color,
        cursor: 'pointer',
        padding: 0,
        transition: 'background 0.12s, border-color 0.12s, color 0.12s',
      }}
      onMouseEnter={e => { if (state === 'idle') e.currentTarget.style.color = 'var(--info-text)'; }}
      onMouseLeave={e => { if (state === 'idle') e.currentTarget.style.color = 'var(--text-muted)'; }}
    >
      {state === 'copied' ? (
        /* check */
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        /* clipboard */
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="11" height="12" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

/**
 * The station-name companion: one clipboard icon that copies the station's
 * ZeroTier IP. Renders nothing when the station has no IP configured, so it can
 * be dropped after any station name without guarding at the call site.
 */
export function ZerotierCopy({ ip, size = 18 }: { ip?: string | null; size?: number }) {
  if (!ip) return null;
  return <CopyButton value={ip} title={`Copy ZeroTier IP — ${ip}`} size={size} />;
}
