'use client';

import { useState, useMemo, useRef } from 'react';

export interface EnergyPoint {
  date: string;        // YYYY-MM-DD
  head1Kwh: number;
  head2Kwh: number;
  head1Sessions: number;
  head2Sessions: number;
}

interface Props {
  data: EnergyPoint[];
  height?: number;
  mode?: 'kwh' | 'sessions';
}

/**
 * Multi-series line chart with hover tooltip + crosshair.
 *  - Two series (Head 1 / Head 2) drawn together
 *  - Hovering shows a vertical guideline and a tooltip with both values
 *  - Highlights the data point dots under the cursor
 */
export default function EnergyChart({ data, height = 240, mode = 'kwh' }: Props) {
  const [hover, setHover] = useState<{ i: number; x: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (!data || data.length === 0) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        No data
      </div>
    );
  }

  const W = 800;
  const H = height;
  const PAD = { top: 18, right: 20, bottom: 32, left: 56 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const series1 = data.map(d => (mode === 'kwh' ? d.head1Kwh : d.head1Sessions));
  const series2 = data.map(d => (mode === 'kwh' ? d.head2Kwh : d.head2Sessions));
  const allValues = [...series1, ...series2];
  const maxVal = Math.max(...allValues, 1);
  const minVal = 0;
  const padY = maxVal * 0.15;
  const yMin = minVal;
  const yMax = maxVal + padY;

  const toX = (i: number) => data.length === 1
    ? PAD.left + chartW / 2
    : PAD.left + (i / (data.length - 1)) * chartW;
  const toY = (v: number) => PAD.top + chartH - ((v - yMin) / (yMax - yMin || 1)) * chartH;

  // Pre-compute point coords for both series
  const p1 = useMemo(() => series1.map((v, i) => ({ x: toX(i), y: toY(v) })), [data, mode]);
  const p2 = useMemo(() => series2.map((v, i) => ({ x: toX(i), y: toY(v) })), [data, mode]);

  const path1 = p1.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const path2 = p2.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const fill1Path = p1.length > 1 ? `${path1} L${p1[p1.length - 1].x.toFixed(1)},${(PAD.top + chartH).toFixed(1)} L${p1[0].x.toFixed(1)},${(PAD.top + chartH).toFixed(1)} Z` : '';
  const fill2Path = p2.length > 1 ? `${path2} L${p2[p2.length - 1].x.toFixed(1)},${(PAD.top + chartH).toFixed(1)} L${p2[0].x.toFixed(1)},${(PAD.top + chartH).toFixed(1)} Z` : '';

  // Y-axis ticks
  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (i / 4) * (yMax - yMin));

  // X-axis labels — limit to ~7 ticks
  const xStep = Math.max(1, Math.ceil(data.length / 7));
  const xLabelIdx = data.map((_, i) => i).filter(i => i % xStep === 0 || i === data.length - 1);

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xRel = ((e.clientX - rect.left) / rect.width) * W;
    // Find closest index
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < data.length; i++) {
      const d = Math.abs(toX(i) - xRel);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    setHover({ i: best, x: toX(best) });
  }

  function handleLeave() { setHover(null); }

  const hovered = hover ? data[hover.i] : null;
  const hov1 = hover ? p1[hover.i] : null;
  const hov2 = hover ? p2[hover.i] : null;
  const unit = mode === 'kwh' ? ' kWh' : '';

  // Tooltip position — try to keep on-screen
  const tooltipW = 170;
  const tooltipH = 92;
  let tooltipX = hover ? hover.x + 10 : 0;
  let tooltipY = PAD.top + 6;
  if (hover && hover.x + 10 + tooltipW > W - PAD.right) {
    tooltipX = hover.x - 10 - tooltipW;
  }

  return (
    <div style={{ width: '100%', overflow: 'hidden', position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height, display: 'block' }}
        preserveAspectRatio="none"
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        <defs>
          <linearGradient id="fill-h1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--info)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--info)" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="fill-h2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--warn)" stopOpacity="0.20" />
            <stop offset="100%" stopColor="var(--warn)" stopOpacity="0.02" />
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

        {/* Series fills */}
        {fill1Path && <path d={fill1Path} fill="url(#fill-h1)" />}
        {fill2Path && <path d={fill2Path} fill="url(#fill-h2)" />}

        {/* Series 1 line + dots */}
        {data.length > 1 && (
          <path d={path1} fill="none" stroke="var(--info)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        )}
        {p1.map((p, i) => (
          <circle key={`d1-${i}`} cx={p.x} cy={p.y} r={hover?.i === i ? 5 : 3} fill="var(--info)" stroke="var(--bg-surface)" strokeWidth="1.5" />
        ))}

        {/* Series 2 line + dots */}
        {data.length > 1 && (
          <path d={path2} fill="none" stroke="var(--warn)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="6,3" />
        )}
        {p2.map((p, i) => (
          <circle key={`d2-${i}`} cx={p.x} cy={p.y} r={hover?.i === i ? 5 : 3} fill="var(--warn)" stroke="var(--bg-surface)" strokeWidth="1.5" />
        ))}

        {/* Crosshair vertical */}
        {hover && (
          <line
            x1={hover.x} y1={PAD.top}
            x2={hover.x} y2={PAD.top + chartH}
            stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="3,3" opacity="0.7"
          />
        )}

        {/* Y-axis labels */}
        {yTicks.map((v, i) => (
          <text key={`y-${i}`} x={PAD.left - 8} y={toY(v) + 3} textAnchor="end" fontSize="10" fill="var(--text-muted)" fontFamily="monospace">
            {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}
          </text>
        ))}

        {/* X-axis labels */}
        {xLabelIdx.map(i => {
          const d = data[i];
          const dt = new Date(d.date + 'T00:00:00Z');
          const label = `${(dt.getUTCMonth() + 1).toString().padStart(2, '0')}-${dt.getUTCDate().toString().padStart(2, '0')}`;
          return (
            <text key={`x-${i}`} x={toX(i)} y={PAD.top + chartH + 16} textAnchor="middle" fontSize="10" fill="var(--text-muted)" fontFamily="monospace">
              {label}
            </text>
          );
        })}

        {/* Tooltip */}
        {hover && hovered && hov1 && hov2 && (() => {
          const h1Val = mode === 'kwh' ? hovered.head1Kwh : hovered.head1Sessions;
          const h2Val = mode === 'kwh' ? hovered.head2Kwh : hovered.head2Sessions;
          const total = h1Val + h2Val;
          const fmt = (v: number) => mode === 'kwh' ? v.toFixed(2) : v.toFixed(0);
          return (
            <g>
              <rect
                x={tooltipX} y={tooltipY}
                width={tooltipW} height={tooltipH}
                rx="6"
                fill="var(--bg-surface)"
                stroke="var(--border)"
                strokeWidth="1"
                style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.15))' }}
              />
              <text x={tooltipX + 10} y={tooltipY + 18} fontSize="11" fontWeight="700" fill="var(--text-primary)" fontFamily="monospace">
                {hovered.date}
              </text>
              <line x1={tooltipX + 8} x2={tooltipX + tooltipW - 8} y1={tooltipY + 25} y2={tooltipY + 25} stroke="var(--border-subtle)" />

              <circle cx={tooltipX + 14} cy={tooltipY + 40} r="4" fill="var(--info)" />
              <text x={tooltipX + 24} y={tooltipY + 43} fontSize="10" fill="var(--text-secondary)" fontFamily="monospace">
                Head 1
              </text>
              <text x={tooltipX + tooltipW - 8} y={tooltipY + 43} textAnchor="end" fontSize="11" fontWeight="700" fill="var(--info-text)" fontFamily="monospace">
                {fmt(h1Val)}{unit}
              </text>

              <circle cx={tooltipX + 14} cy={tooltipY + 58} r="4" fill="var(--warn)" />
              <text x={tooltipX + 24} y={tooltipY + 61} fontSize="10" fill="var(--text-secondary)" fontFamily="monospace">
                Head 2
              </text>
              <text x={tooltipX + tooltipW - 8} y={tooltipY + 61} textAnchor="end" fontSize="11" fontWeight="700" fill="var(--warn-text)" fontFamily="monospace">
                {fmt(h2Val)}{unit}
              </text>

              <line x1={tooltipX + 8} x2={tooltipX + tooltipW - 8} y1={tooltipY + 70} y2={tooltipY + 70} stroke="var(--border-subtle)" />
              <text x={tooltipX + 10} y={tooltipY + 84} fontSize="10" fill="var(--text-muted)" fontFamily="monospace">
                Total
              </text>
              <text x={tooltipX + tooltipW - 8} y={tooltipY + 84} textAnchor="end" fontSize="11" fontWeight="700" fill="var(--text-primary)" fontFamily="monospace">
                {fmt(total)}{unit}
              </text>
            </g>
          );
        })()}
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 6, fontSize: 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 16, height: 2, background: 'var(--info)' }} />
          <span style={{ color: 'var(--text-secondary)' }}>Head 1</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 16, height: 2, background: 'var(--warn)',
            backgroundImage: 'repeating-linear-gradient(90deg, var(--warn) 0 6px, transparent 6px 9px)',
          }} />
          <span style={{ color: 'var(--text-secondary)' }}>Head 2</span>
        </div>
      </div>
    </div>
  );
}
