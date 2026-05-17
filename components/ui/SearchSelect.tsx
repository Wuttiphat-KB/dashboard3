'use client';

import { useState, useRef, useEffect, useMemo } from 'react';

export interface SearchOption {
  value: string;
  label: string;
  hint?: string;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  options: SearchOption[];
  placeholder?: string;
  width?: number | string;
  size?: 'sm' | 'md';
}

export default function SearchSelect({
  value,
  onChange,
  options,
  placeholder = 'Search...',
  width = 240,
  size = 'md',
}: Props) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const [focusIdx, setFocusIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find(o => o.value === value);
  const fontSize = size === 'sm' ? 11 : 13;

  // Close when clicking outside
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Auto-focus input when opening
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
      setQuery('');
      setFocusIdx(0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o =>
      o.label.toLowerCase().includes(q) ||
      o.value.toLowerCase().includes(q) ||
      (o.hint?.toLowerCase().includes(q) ?? false),
    );
  }, [options, query]);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIdx(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[focusIdx]) pick(filtered[focusIdx].value);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative', width }}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '6px 28px 6px 10px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-primary)',
          fontSize,
          fontFamily: 'var(--font-geist-mono), monospace',
          cursor: 'pointer',
          position: 'relative',
          height: size === 'sm' ? 28 : 32,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {selected?.label || <span style={{ color: 'var(--text-muted)' }}>{placeholder}</span>}
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 9, color: 'var(--text-muted)' }}>
          ▾
        </span>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0, right: 0,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: '0 6px 16px rgba(0,0,0,0.18)',
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 320,
          }}
        >
          {/* Search input */}
          <div style={{ padding: 6, borderBottom: '1px solid var(--border-subtle)' }}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setFocusIdx(0); }}
              onKeyDown={onKey}
              placeholder={placeholder}
              className="input"
              style={{ width: '100%', fontSize: 12, height: 28 }}
            />
          </div>

          {/* Result list */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0 && (
              <div style={{ padding: 12, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                No match
              </div>
            )}
            {filtered.map((o, i) => {
              const isActive   = o.value === value;
              const isFocused  = i === focusIdx;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => pick(o.value)}
                  onMouseEnter={() => setFocusIdx(i)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '6px 10px',
                    fontSize, lineHeight: 1.4,
                    fontFamily: 'var(--font-geist-mono), monospace',
                    background: isFocused ? 'var(--info-bg)' : 'transparent',
                    color:      isActive  ? 'var(--info-text)' : 'var(--text-primary)',
                    fontWeight: isActive  ? 700 : 400,
                    border: 'none',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {o.label}
                  {o.hint && <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: fontSize - 1 }}>{o.hint}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
