import type { CustomerInfo } from './types';

/** Shared validation for the editor and API; older stations may omit customer. */
export function validateCustomerInfo(value: unknown): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return 'Customer information must be an object';
  }
  const { name } = value as Record<string, unknown>;
  if (name !== undefined && typeof name !== 'string') return 'Customer name must be text';
  if (typeof name === 'string' && name.trim().length > 200) return 'Customer name must be 200 characters or fewer';
  return null;
}

export function trimCustomerInfo(customer: CustomerInfo = {}): CustomerInfo {
  return { name: customer.name?.trim() ?? '' };
}
