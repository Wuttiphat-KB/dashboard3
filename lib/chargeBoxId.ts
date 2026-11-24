/**
 * ChargeBox ID — the identity the charger announces to the OCPP central system
 * (OCPP 1.6 `chargePointId`, a CiString48Type: printable ASCII, 48 characters at most).
 *
 * Shared validation for the /config editor and POST /api/stations/save. The field is
 * optional: undefined or blank means "not set". Case is kept exactly as typed.
 */
export const CHARGE_BOX_ID_MAX_LENGTH = 48;

// Printable ASCII without the space: no whitespace inside the ID, and Thai text typed
// by mistake (wrong keyboard layout) is rejected instead of being saved.
const CHARGE_BOX_ID_RE = /^[\x21-\x7E]+$/;

export function validateChargeBoxId(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') return 'ChargeBox ID must be text';
  const id = value.trim();
  if (id === '') return null;
  if (id.length > CHARGE_BOX_ID_MAX_LENGTH) {
    return `ChargeBox ID must be ${CHARGE_BOX_ID_MAX_LENGTH} characters or fewer`;
  }
  if (!CHARGE_BOX_ID_RE.test(id)) {
    return 'ChargeBox ID may only contain English letters, digits and symbols (no spaces or Thai characters)';
  }
  return null;
}

export function trimChargeBoxId(value: string | undefined | null): string {
  return value?.trim() ?? '';
}
