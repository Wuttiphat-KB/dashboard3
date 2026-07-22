'use client';

import { useState, useRef, useEffect } from 'react';

export interface PeakHourPoint {
  hour: number;       // 0..23
  totalKwh: number;
  avgKwh: number;
}

interface Props {
  data: PeakHourPoint[];   // length 24
  height?: number;
  peakHour?: number;       // 0..23, highlighted with a different colour
}

/**
 * 24-hour vertical bar chart. Hover shows total + avg kWh for that hour.
 *
 * Uses ResizeObserver like EnergyChart so labels stay crisp at any width.
 */
export default function PeakHoursBarChart({ data, height = 260, peakHour }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const [W, setW] = useState(800);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

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

  const H = height;
  const PAD = { top: 18, right: 20, bottom: 32, left: 56 };
  const chartW = Math.max(50, W - PAD.left - PAD.right);
  const chartH = H - PAD.top - PAD.bottom;

  if (!data || data.length === 0) {
    return (
      <div ref={wrapperRef} style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        No data
      </div>
    );
  }

  const maxVal = Math.max(...data.map(d => d.totalKwh), 1);
  const yMax = maxVal + maxVal * 0.15;

  const barCount = data.length;   // 24
  const slotW = chartW / barCount;
  const barW = Math.max(4, slotW * 0.72);

  const toX = (i: number) => PAD.left + slotW * i + (slotW - barW) / 2;
  const toY = (v: number) => PAD.top + chartH - (v / yMax) * chartH;

  const yTicks = Array.from({ length: 5 }, (_, i) => (i / 4) * yMax);

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xRel = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.floor((xRel - PAD.left) / slotW);
    if (idx >= 0 && idx < barCount) setHover(idx);
    else setHover(null);
  }

  const hovered = hover != null ? data[hover] : null;

  const tooltipW = 180;
  const tooltipH = 74;
  const tooltipX = hover != null
    ? Math.min(W - PAD.right - tooltipW, toX(hover) + barW + 8)
    : 0;
  const tooltipY = PAD.top + 6;

  return (
    <div ref={wrapperRef} style={{ width: '100%', position: 'relative' }}>
      <svg
        ref={svgRef}
        width={W}
        height={H}
        style={{ display: 'block' }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="peak-bar-normal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--info)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--info)" stopOpacity="0.5" />
          </linearGradient>
          <linearGradient id="peak-bar-peak" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--warn)" stopOpacity="1" />
            <stop offset="100%" stopColor="var(--warn)" stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id="peak-bar-hover" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--ok)" stopOpacity="1" />
            <stop offset="100%" stopColor="var(--ok)" stopOpacity="0.65" />
          </linearGradient>
        </defs>

        {/* Grid */}
        {yTicks.map((v, i) => (
          <line
            key={i}
            x1={PAD.left} y1={toY(v).toFixed(1)}
            x2={PAD.left + chartW} y2={toY(v).toFixed(1)}
            stroke="var(--border-subtle)" strokeWidth="1"
            strokeDasharray={i === 0 ? '' : '3,3'}
          />
        ))}

        {/* Bars */}
        {data.map((d, i) => {
          const y = toY(d.totalKwh);
          const barH = PAD.top + chartH - y;
          const isPeak  = peakHour === d.hour;
          const isHover = hover === i;
          const fill = isHover
            ? 'url(#peak-bar-hover)'
            : isPeak
              ? 'url(#peak-bar-peak)'
              : 'url(#peak-bar-normal)';
          return (
            <rect
              key={i}
              x={toX(i)} y={y}
              width={barW} height={Math.max(0, barH)}
              fill={fill}
              rx="2"
            />
          );
        })}

        {/* Y-axis labels */}
        {yTicks.map((v, i) => (
          <text key={`y-${i}`} x={PAD.left - 8} y={toY(v) + 3} textAnchor="end" fontSize="10" fill="var(--text-muted)" fontFamily="monospace">
            {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}
          </text>
        ))}

        {/* Y-axis unit */}
        <text
          x={PAD.left - 8} y={PAD.top - 6}
          textAnchor="end" fontSize="9" fill="var(--text-muted)" fontFamily="monospace"
        >
          kWh
        </text>

        {/* X-axis labels — every 2 or 3 hours depending on width */}
        {data.map((d, i) => {
          const step = chartW > 640 ? 2 : 3;
          if (i % step !== 0 && i !== 23) return null;
          return (
            <text
              key={`x-${i}`}
              x={toX(i) + barW / 2}
              y={PAD.top + chartH + 16}
              textAnchor="middle" fontSize="10"
              fill="var(--text-muted)" fontFamily="monospace"
            >
              {String(d.hour).padStart(2, '0')}
            </text>
          );
        })}

        {/* Axis line under bars */}
        <line
          x1={PAD.left} y1={PAD.top + chartH}
          x2={PAD.left + chartW} y2={PAD.top + chartH}
          stroke="var(--border)" strokeWidth="1"
        />

        {/* Tooltip */}
        {hover != null && hovered && (
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
              {String(hovered.hour).padStart(2, '0')}:00 – {String(hovered.hour).padStart(2, '0')}:59
            </text>
            <line x1={tooltipX + 10} x2={tooltipX + tooltipW - 10} y1={tooltipY + 25} y2={tooltipY + 25} stroke="var(--border-subtle)" />

            <text x={tooltipX + 12} y={tooltipY + 42} fontSize="10" fill="var(--text-secondary)" fontFamily="monospace">
              Total
            </text>
            <text x={tooltipX + tooltipW - 10} y={tooltipY + 42} textAnchor="end" fontSize="11" fontWeight="700" fill="var(--info-text)" fontFamily="monospace">
              {hovered.totalKwh.toFixed(1)} kWh
            </text>

            <text x={tooltipX + 12} y={tooltipY + 60} fontSize="10" fill="var(--text-secondary)" fontFamily="monospace">
              Avg / day
            </text>
            <text x={tooltipX + tooltipW - 10} y={tooltipY + 60} textAnchor="end" fontSize="11" fontWeight="700" fill="var(--text-primary)" fontFamily="monospace">
              {hovered.avgKwh.toFixed(1)} kWh
            </text>
          </g>
        )}
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginTop: 6, fontSize: 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 12, height: 10, background: 'var(--info)', opacity: 0.75, borderRadius: 2 }} />
          <span style={{ color: 'var(--text-secondary)' }}>Hourly kWh</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 12, height: 10, background: 'var(--warn)', opacity: 0.9, borderRadius: 2 }} />
          <span style={{ color: 'var(--text-secondary)' }}>Peak hour</span>
        </div>
      </div>
    </div>
  );
}
