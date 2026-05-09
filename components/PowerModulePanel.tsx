'use client';

import { PowerModuleHead, PlcData } from '@/lib/types';
import { fmtTs, timeSince } from '@/lib/formatTime';

interface Props {
  heads: PowerModuleHead[];
  stationId: string;
  expectedPmHead1?: number;
  expectedPmHead2?: number;
  /** @deprecated kept for backward compat */
  expectedPmPerHead?: number;
  plcData?: PlcData;
}

// PM bubble grid — green = active, grey = empty slot
function PmBubbles({ count, expected }: { count: number; expected: number }) {
  const slots = Math.max(count, expected, 1);
  const isFull = count >= expected && expected > 0;
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {Array.from({ length: slots }, (_, i) => {
        const active = i < count;
        return (
          <div key={i} style={{
            width: 44, height: 44, borderRadius: 8,
            background: active ? 'var(--ok-bg)' : 'var(--bg-base)',
            border: `2px solid ${active ? 'var(--ok)' : 'var(--border-subtle)'}`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 1,
          }}>
            {active ? (
              <>
                <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--ok-text)' }}>PM</span>
                <span style={{ fontSize: 9, color: 'var(--ok-text)', opacity: 0.7 }}>{i + 1}</span>
              </>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HeadCard({ head, expected, plcHead, totalHeads }: { head: PowerModuleHead; expected: number; plcHead?: { chargeState: string; powerKw: number; soc: number }; totalHeads?: number }) {
  const isFull    = expected > 0 ? head.pmCount >= expected : head.pmCount > 0;
  const isOffline = !head.online;
  const borderColor = isOffline ? 'var(--border)' : isFull ? 'var(--ok)' : 'var(--error)';
  const pmColor     = isOffline ? 'var(--text-muted)' : isFull ? 'var(--ok)' : 'var(--error)';
  const bgColor     = isOffline ? 'var(--bg-card)' : isFull ? 'var(--ok-bg)' : 'var(--error-bg)';

  return (
    <div className="card" style={{ borderColor, opacity: isOffline ? 0.6 : 1 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: 'var(--info-bg)', color: 'var(--info-text)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 700,
          }}>
            {head.head}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
              {totalHeads === 1 ? 'Charger' : `Charger Head ${head.head}`}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
              MQTT: PM{head.head} field
            </div>
          </div>
        </div>
        {isOffline ? (
          <span className="badge badge-offline">NO DATA</span>
        ) : (
          <span className={`badge ${isFull ? 'badge-ok' : 'badge-error'}`}>
            <span className={`led ${isFull ? 'led-ok led-pulse' : 'led-error'}`} />
            {isFull ? 'FULL' : 'INCOMPLETE'}
          </span>
        )}
      </div>

      {/* Charge state */}
      {plcHead && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', marginBottom: 14,
          background: plcHead.chargeState === 'Charging' ? 'var(--warn-bg)' : plcHead.chargeState === 'Fault' ? 'var(--error-bg)' : 'var(--bg-elevated)',
          border: `1px solid ${plcHead.chargeState === 'Charging' ? 'var(--warn)' : plcHead.chargeState === 'Fault' ? 'var(--error)' : 'var(--border)'}`,
          borderRadius: 8,
        }}>
          <span className={`badge ${plcHead.chargeState === 'Charging' ? 'badge-warn' : plcHead.chargeState === 'Fault' ? 'badge-error' : 'badge-offline'}`}>
            <span className={`led ${plcHead.chargeState === 'Charging' ? 'led-warn led-pulse' : plcHead.chargeState === 'Fault' ? 'led-error' : ''}`} />
            {plcHead.chargeState}
          </span>
          {plcHead.chargeState === 'Charging' && (
            <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: 'var(--warn-text)' }}>
              {plcHead.powerKw} kW · SOC {plcHead.soc}%
            </span>
          )}
        </div>
      )}

      {/* Big PM count */}
      <div style={{
        background: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
        padding: '16px 18px',
        marginBottom: 14,
        display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <div style={{ textAlign: 'center', minWidth: 60 }}>
          <div style={{ fontSize: 52, fontWeight: 900, color: pmColor, lineHeight: 1 }}>
            {isOffline ? '—' : head.pmCount}
          </div>
          {expected > 0 && !isOffline && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              / {expected} expected
            </div>
          )}
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 3 }}>
            Power Modules Active
          </div>
        </div>

        {!isOffline && (
          <div style={{ flex: 1 }}>
            <PmBubbles count={head.pmCount} expected={expected > 0 ? expected : head.pmCount} />
            {!isFull && expected > 0 && head.pmCount < expected && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--error-text)', fontWeight: 600 }}>
                {expected - head.pmCount} module{expected - head.pmCount > 1 ? 's' : ''} missing
              </div>
            )}
          </div>
        )}
      </div>

      {/* Timestamp — from MongoDB */}
      <div style={{
        padding: '8px 12px',
        background: 'var(--bg-elevated)',
        borderRadius: 6,
        display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Last Data (MongoDB)
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-secondary)' }}>
            {fmtTs(head.timestamp)}
          </span>
          <span style={{ fontSize: 10, color: isOffline ? 'var(--error-text)' : 'var(--text-muted)' }}>
            {timeSince(head.timestamp)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function PowerModulePanel({ heads, stationId, expectedPmHead1, expectedPmHead2, expectedPmPerHead = 0, plcData }: Props) {
  const expectedFor = (head: number): number => {
    if (head === 1) return expectedPmHead1 ?? expectedPmPerHead;
    if (head === 2) return expectedPmHead2 ?? expectedPmPerHead;
    return expectedPmPerHead;
  };
  const totalPM     = heads.reduce((s, h) => s + (h.online ? h.pmCount : 0), 0);
  const onlineHeads = heads.filter(h => h.online).length;
  const allFull     = heads.every(h => {
    if (!h.online) return true;
    const exp = expectedFor(h.head);
    return exp === 0 ? h.pmCount > 0 : h.pmCount >= exp;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
        {[
          { label: 'Heads Online',    value: `${onlineHeads}/${heads.length}`, unit: '', color: onlineHeads === heads.length ? 'var(--ok)' : 'var(--warn)' },
          { label: 'Status',          value: allFull ? 'FULL' : 'INCOMPLETE', unit: '', color: allFull ? 'var(--ok)' : 'var(--error)' },
        ].map(s => (
          <div key={s.label} className="card" style={{ padding: '0.875rem' }}>
            <div className="stat-value" style={{ color: s.color, fontSize: 20 }}>
              {s.value}<span className="stat-unit">{s.unit}</span>
            </div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Head cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
        {heads.map(head => {
          const plcHead = plcData ? (head.head === 1 ? plcData.head1 : plcData.head2) : undefined;
          return (
            <HeadCard key={head.head} head={head} expected={expectedFor(head.head)}
              totalHeads={heads.length}
              plcHead={plcHead ? { chargeState: plcHead.chargeState, powerKw: plcHead.powerKw, soc: plcHead.soc } : undefined} />
          );
        })}
      </div>

      {/* Note */}
      <div className="card" style={{ padding: '0.75rem 1rem', background: 'var(--info-bg)', border: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 11, color: 'var(--info-text)', fontWeight: 600, marginBottom: 4 }}>MongoDB Integration Note</div>
        <div style={{ fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          Power module data forwarded to MongoDB on each MQTT message. Dashboard loads latest document from
          <code style={{ background: 'var(--bg-base)', padding: '1px 4px', borderRadius: 3, margin: '0 3px' }}>
            {stationId.toLowerCase().replace('-', '')}_powermodule
          </code>
          immediately — no need to wait for next MQTT publish.
        </div>
      </div>
    </div>
  );
}
