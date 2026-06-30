// Resolve a station's text `location` into map coordinates.
//
// Stations only store a free-text location string (e.g. "Bangkok – Central
// Plaza Ladprao"). To plot them on a map we look the string up here. We try an
// exact per-location match first (precise mall coordinates), then fall back to
// a city-level coordinate keyed by the text before the dash, and finally a
// loose "city name appears anywhere" match. Returns null when nothing matches
// so the map page can list the station as "no location".

export interface LatLng { lat: number; lng: number; }

// Precise coordinates for the known fleet locations (mall-level).
const LOCATION_COORDS: Record<string, LatLng> = {
  'Bangkok – Central Plaza Ladprao':            { lat: 13.8161, lng: 100.5615 },
  'Bangkok – Future Park Rangsit':              { lat: 13.9889, lng: 100.6178 },
  'Bangkok – Mega Bangna':                      { lat: 13.6450, lng: 100.6840 },
  'Bangkok – Seacon Square Srinakarin':         { lat: 13.6890, lng: 100.6470 },
  'Chiang Mai – Maya Lifestyle Shopping Center':{ lat: 18.8010, lng: 98.9686 },
  'Chiang Mai – Central Festival Chiang Mai':   { lat: 18.8070, lng: 99.0150 },
  'Phuket – Central Floresta Phuket':           { lat: 7.8920,  lng: 98.3700 },
  'Pattaya – Terminal 21 Pattaya':              { lat: 12.9300, lng: 100.8800 },
  'Khon Kaen – Central Plaza Khon Kaen':        { lat: 16.4470, lng: 102.8330 },
  'Hat Yai – Lee Gardens Plaza':                { lat: 7.0090,  lng: 100.4740 },
  'Udon Thani – Central Plaza Udon Thani':      { lat: 17.4110, lng: 102.7870 },
  'Nakhon Si Thammarat – Central Nakhon Si':    { lat: 8.4310,  lng: 99.9630 },
  "Rayong – Lotus's Extra Rayong":              { lat: 12.6800, lng: 101.2700 },
};

// City-level fallback — keyed by the city name (the text before the dash).
const CITY_COORDS: Record<string, LatLng> = {
  'Bangkok':             { lat: 13.7563, lng: 100.5018 },
  'Chiang Mai':          { lat: 18.7883, lng: 98.9853 },
  'Phuket':              { lat: 7.8804,  lng: 98.3923 },
  'Pattaya':             { lat: 12.9236, lng: 100.8825 },
  'Khon Kaen':           { lat: 16.4419, lng: 102.8360 },
  'Hat Yai':             { lat: 7.0086,  lng: 100.4747 },
  'Udon Thani':          { lat: 17.4138, lng: 102.7870 },
  'Nakhon Si Thammarat': { lat: 8.4304,  lng: 99.9631 },
  'Rayong':              { lat: 12.6814, lng: 101.2816 },
};

/** City name = text before the first en-dash / hyphen. */
export function cityOf(location: string | undefined | null): string {
  if (!location) return '';
  return location.split(/[–-]/)[0].trim();
}

export function resolveCoords(location: string | undefined | null): LatLng | null {
  if (!location) return null;
  const loc = location.trim();

  if (LOCATION_COORDS[loc]) return LOCATION_COORDS[loc];

  const city = cityOf(loc);
  if (CITY_COORDS[city]) return CITY_COORDS[city];

  // Loose match — city name appears anywhere in the string.
  const lower = loc.toLowerCase();
  for (const key of Object.keys(CITY_COORDS)) {
    if (lower.includes(key.toLowerCase())) return CITY_COORDS[key];
  }
  return null;
}

// Geographic center of Thailand — used as the initial map view.
export const THAILAND_CENTER: LatLng = { lat: 13.0, lng: 101.0 };
