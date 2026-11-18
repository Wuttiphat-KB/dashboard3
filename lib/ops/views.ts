/** Ops console views (Charger Ops) — shared by the sidebar and the /ops/[view] route. */
export const OPS_VIEWS = [
  { id: 'overview',  label: 'Fleet Overview',    abbr: 'FO', group: 'See' },
  { id: 'fleet',     label: 'Fleet Monitor',     abbr: 'FM', group: 'See' },
  { id: 'charger',   label: 'Charger 360',       abbr: 'C3', group: 'See' },
  { id: 'replay',    label: 'Session Replay',    abbr: 'SR', group: 'Diagnose' },
  { id: 'funnel',    label: 'Charging Funnel',   abbr: 'CF', group: 'Diagnose' },
  { id: 'assistant', label: 'AI Assistant',      abbr: 'AI', group: 'Diagnose' },
  { id: 'alerts',    label: 'Alerts & Rules',    abbr: 'AR', group: 'Act' },
  { id: 'compat',    label: 'EV Compatibility',  abbr: 'EC', group: 'Act' },
  { id: 'tickets',   label: 'Tickets',           abbr: 'TK', group: 'Act' },
  { id: 'releases',  label: 'Firmware & Config', abbr: 'FW', group: 'Act' },
] as const;

export const OPS_VIEW_IDS: string[] = OPS_VIEWS.map(v => v.id);
