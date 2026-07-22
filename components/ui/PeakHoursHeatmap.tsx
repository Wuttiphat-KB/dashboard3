'use client';

import { useState, useRef, useEffect } from 'react';

interface Props {
  data: number[][];        // [7 days][24 hours] — kWh values
  dayNames: readonly string[]; // ["Sun","Mon",...,"Sat"]
  height?: number;
  peakDay?: number;        // 0..6, highlight the row header
  peakHour?: number;       // 0..23, highlight the column header
}

/**
 * 7×24 kWh heatmap. Cells shaded by intensity relative to the max value.
 * Sunday row is on top so a "weekend" cluster (Sat/Sun) sits at edges — matches
 * typical desktop heatmap conventions.
 */
export default function PeakHoursHeatmap({ data, dayNames, height = 260, peakDay, peakHour }: Props) {
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const [W, setW] = useState(800);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = Math.round(entries[0].contentRect.width);
      if (w > 0) setW(w);
    });
    ro.observe(el);
    setW(Math.max(320, Math.round(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);

  if (!data || data.length === 0) {
    return (
      <div ref={wrapperRef} style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        No data
      </div>
    );
  }

  const H = height;
  const PAD = { top: 26, right: 12, bottom: 26, left: 44 };
  const gridW = Math.max(50, W - PAD.left - PAD.right);
  const gridH = H - PAD.top - PAD.bottom;
  const cellW = gridW / 24;
  const cellH = gridH / 7;

  // Find max value across all cells for normalization
  let maxVal = 0;
  for (const row of data) for (const v of row) if (v > maxVal) maxVal = v;
  if (maxVal === 0) maxVal = 1;

  /**
   * Colour for a cell — 5-stop gradient from empty (bg-elevated) through
   * info-bg → info → warn-bg → warn. Uses HSL blend of two theme colours.
   */
  function cellColor(v: number): string {
    if (v <= 0) return 'var(--bg-elevated)';
    const t = Math.min(1, v / maxVal);
    // Piecewise: 0..0.5 = teal→blue, 0.5..1 = blue→amber
    if (t < 0.33) {
      const a = t / 0.33;
      return `rgba(56,189,248,${0.15 + a * 0.35})`;  // sky-400
    } else if (t < 0.66) {
      const a = (t - 0.33) / 0.33;
      return `rgba(59,130,246,${0.5 + a * 0.3})`;    // blue-500
    } else {
      const a = (t - 0.66) / 0.34;
      return `rgba(245,158,11,${0.65 + a * 0.35})`;  // amber-500
    }
  }

  const hovered = hover ? { day: dayNames[hover.d], hour: hover.h, kwh: data[hover.d][hover.h] } : null;

  const tooltipW = 190;
  const tooltipH = 68;

  // Position tooltip near cursor, clamp so it stays inside the SVG
  let tooltipX = 0, tooltipY = 0;
  if (hover) {
    tooltipX = PAD.left + hover.h * cellW + cellW + 8;
    tooltipY = PAD.top + hover.d * cellH;
    if (tooltipX + tooltipW > W - PAD.right) tooltipX = PAD.left + hover.h * cellW - tooltipW - 8;
    if (tooltipY + tooltipH > H - PAD.bottom) tooltipY = H - PAD.bottom - tooltipH;
    if (tooltipY < PAD.top) tooltipY = PAD.top;
  }

  return (
    <div ref={wrapperRef} style={{ width: '100%', position: 'relative' }}>
      <svg width={W} height={H} style={{ display: 'block' }}>
        {/* Column headers (hours) */}
        {Array.from({ length: 24 }).map((_, h) => {
          const step = gridW > 640 ? 2 : 3;
          if (h % step !== 0 && h !== 23) return null;
          return (
            <text
              key={`ch-${h}`}
              x={PAD.left + h * cellW + cellW / 2}
              y={PAD.top - 8}
              textAnchor="middle" fontSize="10"
              fill={peakHour === h ? 'var(--warn-text)' : 'var(--text-muted)'}
              fontFamily="monospace"
              fontWeight={peakHour === h ? 700 : 400}
            >
              {String(h).padStart(2, '0')}
            </text>
          );
        })}

        {/* Row headers (days) */}
        {dayNames.map((name, d) => (
          <text
            key={`rh-${d}`}
            x={PAD.left - 8}
            y={PAD.top + d * cellH + cellH / 2 + 4}
            textAnchor="end" fontSize="10"
            fill={peakDay === d ? 'var(--warn-text)' : 'var(--text-muted)'}
            fontFamily="monospace"
            fontWeight={peakDay === d ? 700 : 400}
          >
            {name}
          </text>
        ))}

        {/* Cells */}
        {data.map((row, d) => row.map((v, h) => {
          const isHover = hover && hover.d === d && hover.h === h;
          return (
            <rect
              key={`c-${d}-${h}`}
              x={PAD.left + h * cellW + 1}
              y={PAD.top + d * cellH + 1}
              width={cellW - 2} height={cellH - 2}
              fill={cellColor(v)}
              stroke={isHover ? 'var(--text-primary)' : 'transparent'}
              strokeWidth={isHover ? 1.5 : 0}
              rx="2"
              onMouseEnter={() => setHover({ d, h })}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'crosshair' }}
            />
          );
        }))}

        {/* Tooltip */}
        {hover && hovered && (
          <g style={{ pointerEvents: 'none' }}>
            <rect
              x={tooltipX} y={tooltipY}
              width={tooltipW} height={tooltipH}
              rx="6"
              fill="var(--bg-surface)"
              stroke="var(--border)"
              strokeWidth="1"
              style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.15))' }}
            />
            <text x={tooltipX + 12} y={tooltipY + 18} fontSize="11" fontWeight="700" fill="var(--text-primary)" fontFamily="monospace">
              {hovered.day} · {String(hovered.hour).padStart(2, '0')}:00
            </text>
            <line x1={tooltipX + 10} x2={tooltipX + tooltipW - 10} y1={tooltipY + 25} y2={tooltipY + 25} stroke="var(--border-subtle)" />
            <text x={tooltipX + 12} y={tooltipY + 44} fontSize="10" fill="var(--text-secondary)" fontFamily="monospace">
              Energy
            </text>
            <text x={tooltipX + tooltipW - 10} y={tooltipY + 44} textAnchor="end" fontSize="12" fontWeight="700" fill="var(--info-text)" fontFamily="monospace">
              {hovered.kwh.toFixed(1)} kWh
            </text>
            <text x={tooltipX + 12} y={tooltipY + 60} fontSize="10" fill="var(--text-muted)" fontFamily="monospace">
              Intensity
            </text>
            <text x={tooltipX + tooltipW - 10} y={tooltipY + 60} textAnchor="end" fontSize="10" fill="var(--text-secondary)" fontFamily="monospace">
              {((hovered.kwh / maxVal) * 100).toFixed(0)}% of max
            </text>
          </g>
        )}
      </svg>

      {/* Legend gradient bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginTop: 6, fontSize: 10, color: 'var(--text-muted)' }}>
        <span>0 kWh</span>
        <div style={{
          width: 240, height: 10, borderRadius: 3,
          background: 'linear-gradient(to right, rgba(56,189,248,0.15), rgba(56,189,248,0.5), rgba(59,130,246,0.8), rgba(245,158,11,0.85), rgba(245,158,11,1))',
          border: '1px solid var(--border-subtle)',
        }} />
        <span>{maxVal.toFixed(0)} kWh</span>
      </div>
    </div>
  );
}
