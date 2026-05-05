'use client';

interface DataPoint {
  timestamp: string;
  value: number;
}

interface Props {
  data: DataPoint[];
  height?: number;
  color?: string;
  fillColor?: string;
  showDots?: boolean;
  unit?: string;
  thresholdValue?: number;
  thresholdColor?: string;
}

export default function LineChart({
  data,
  height = 160,
  color = 'var(--info)',
  fillColor,
  showDots = false,
  unit = '',
  thresholdValue,
  thresholdColor = 'var(--warn)',
}: Props) {
  if (!data || data.length < 2) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        No data
      </div>
    );
  }

  const W = 800;
  const H = height;
  const PAD = { top: 12, right: 16, bottom: 28, left: 52 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const values = data.map(d => d.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;
  const padY = range * 0.12;
  const yMin = minVal - padY;
  const yMax = maxVal + padY;

  const toX = (i: number) => PAD.left + (i / (data.length - 1)) * chartW;
  const toY = (v: number) => PAD.top + chartH - ((v - yMin) / (yMax - yMin)) * chartH;

  const points = data.map((d, i) => ({ x: toX(i), y: toY(d.value) }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const fillPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${(PAD.top + chartH).toFixed(1)} L${PAD.left},${(PAD.top + chartH).toFixed(1)} Z`;

  // Y-axis ticks (4)
  const yTicks = Array.from({ length: 4 }, (_, i) => yMin + (i / 3) * (yMax - yMin));

  // X-axis labels (every ~8 points)
  const xStep = Math.ceil(data.length / 6);
  const xLabels = data.filter((_, i) => i % xStep === 0 || i === data.length - 1);

  const threshY = thresholdValue !== undefined ? toY(thresholdValue) : null;

  return (
    <div style={{ width: '100%', overflow: 'hidden' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height, display: 'block' }}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={`fill-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillColor ?? color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={fillColor ?? color} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {yTicks.map((v, i) => (
          <line
            key={i}
            x1={PAD.left} y1={toY(v).toFixed(1)}
            x2={PAD.left + chartW} y2={toY(v).toFixed(1)}
            stroke="var(--border-subtle)" strokeWidth="1"
          />
        ))}

        {/* Threshold line */}
        {threshY !== null && (
          <line
            x1={PAD.left} y1={threshY.toFixed(1)}
            x2={PAD.left + chartW} y2={threshY.toFixed(1)}
            stroke={thresholdColor} strokeWidth="1.5" strokeDasharray="6,4"
          />
        )}

        {/* Fill area */}
        <path
          d={fillPath}
          fill={`url(#fill-${color.replace(/[^a-z0-9]/gi, '')})`}
        />

        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Dots */}
        {showDots && points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={color} />
        ))}

        {/* Y-axis labels */}
        {yTicks.map((v, i) => (
          <text
            key={i}
            x={PAD.left - 6} y={toY(v)}
            textAnchor="end"
            dominantBaseline="middle"
            fontSize="9"
            fill="var(--text-muted)"
          >
            {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}{unit}
          </text>
        ))}

        {/* X-axis labels */}
        {xLabels.map((d) => {
          const i = data.indexOf(d);
          const dt = new Date(d.timestamp);
          const label = `${dt.getHours().toString().padStart(2, '0')}:${dt.getMinutes().toString().padStart(2, '0')}`;
          return (
            <text
              key={i}
              x={toX(i)} y={PAD.top + chartH + 14}
              textAnchor="middle"
              fontSize="9"
              fill="var(--text-muted)"
            >
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
