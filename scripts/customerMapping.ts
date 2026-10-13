export interface SourceCustomerRow { row: number; station: string; customer: string }
export interface MappingStation { id: string; name: string; displayName?: string; customer?: { name?: string } | string }

const key = (value: string) => value.trim().normalize('NFKC').toLocaleLowerCase('en-US');
const withoutNotes = (value: string) => value.replace(/\s*\([^)]*\)\s*$/, '').trim();

export function buildCustomerMapping(sourceRows: SourceCustomerRow[], stations: MappingStation[]) {
  const matches = new Map<string, SourceCustomerRow[]>();
  const unmatchedSource: SourceCustomerRow[] = [];
  const ambiguousSource: Array<SourceCustomerRow & { candidates: string[] }> = [];
  for (const row of sourceRows) {
    const label = key(withoutNotes(row.station));
    // Current internal/display names take priority over IDs that may survive renames.
    let candidates = stations.filter(st => key(st.name) === label);
    if (!candidates.length) candidates = stations.filter(st => key(st.displayName || '') === label);
    if (!candidates.length) candidates = stations.filter(st => key(st.id) === label);
    if (!candidates.length) {
      const prefixed = withoutNotes(row.station).match(/^(\d+)\s+(.+)$/);
      if (prefixed) candidates = stations.filter(st => st.id === prefixed[1] && [st.name, st.displayName || ''].some(name => key(name) === key(prefixed[2])));
    }
    if (!candidates.length) { unmatchedSource.push(row); continue; }
    if (candidates.length !== 1) { ambiguousSource.push({ ...row, candidates: candidates.map(st => st.name) }); continue; }
    const id = candidates[0].id;
    matches.set(id, [...(matches.get(id) || []), row]);
  }
  const mapping = stations.map(station => {
    const matched = matches.get(station.id) || [];
    const customers = [...new Set(matched.map(row => row.customer.trim()).filter(Boolean))];
    const before = typeof station.customer === 'string' ? station.customer.trim() : (station.customer?.name || '').trim();
    const status = customers.length > 1 ? 'conflict' : customers.length === 0 ? (matched.length ? 'source-customer-blank' : 'not-in-source') : before === customers[0] ? 'unchanged' : 'update';
    return { id: station.id, name: station.name, displayName: station.displayName || '', before, customer: customers.length === 1 ? customers[0] : before, status, sourceRows: matched.map(row => row.row) };
  });
  const counts = (field: 'status' | 'customer') => Object.fromEntries([...new Set(mapping.map(row => row[field]))].map(value => [value || '(blank)', mapping.filter(row => row[field] === value).length]));
  return { databaseStations: stations.length, sourceRows: sourceRows.length, statusCounts: counts('status'), customerCountsAfter: counts('customer'), missingCustomer: mapping.filter(row => !row.customer), conflicts: mapping.filter(row => row.status === 'conflict'), ambiguousSource, unmatchedSource, mapping };
}
