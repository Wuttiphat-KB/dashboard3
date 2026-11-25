'use client';

import { describeWarranty, warrantyStatus } from '@/lib/warranty';

interface Props {
  commissioningDate?: string | null;
  warrantyYears?: number | null;
  /**
   * Also show a green "อยู่ในประกัน" badge while the station is covered. Off by
   * default so cards only flag the stations that need attention.
   */
  showActive?: boolean;
}

/**
 * "หมดประกันแล้ว" badge. Renders nothing for a station that is still covered (unless
 * `showActive`) or whose warranty is not set, so it can be dropped into any station
 * card without guarding at the call site.
 */
export default function WarrantyBadge({ commissioningDate, warrantyYears, showActive = false }: Props) {
  const info = warrantyStatus(commissioningDate, warrantyYears);
  if (info.state === 'unknown') return null;
  if (info.state === 'active' && !showActive) return null;

  const expired = info.state === 'expired';
  return (
    <span
      className={`badge ${expired ? 'badge-error' : 'badge-ok'}`}
      title={`${expired ? 'หมดประกัน' : 'อยู่ในประกัน'} ${describeWarranty(info)}`}
    >
      <span className={`led ${expired ? 'led-error' : 'led-ok'}`} style={{ width: 7, height: 7 }} />
      {expired ? 'หมดประกันแล้ว' : 'อยู่ในประกัน'}
    </span>
  );
}
