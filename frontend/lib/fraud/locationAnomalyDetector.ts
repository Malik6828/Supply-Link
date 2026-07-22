/**
 * Location-based anomaly detection for supply chain events.
 * Flags impossible travel times between geographic locations.
 */

export interface KnownLocation {
  name: string;
  lat: number;
  lng: number;
  region: string;
}

export interface TravelAnomalyAlert {
  eventIndex: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  fromLocation: string;
  toLocation: string;
  timeBetweenSeconds: number;
  distanceKm: number;
  requiredSpeedKph: number;
  maxRealisticSpeedKph: number;
}

export interface LocationAnomalyResult {
  productId: string;
  totalEvents: number;
  anomaliesDetected: number;
  alerts: TravelAnomalyAlert[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  analysisTimestamp: string;
}

// Max realistic transport speeds (kph)
const MAX_GROUND_SPEED_KPH = 150;
const MAX_AIR_SPEED_KPH = 950;
const EARTH_RADIUS_KM = 6371;

// Known supply chain hubs with coordinates
const KNOWN_LOCATIONS: Record<string, KnownLocation> = {
  'new york': { name: 'New York', lat: 40.7128, lng: -74.006, region: 'US-East' },
  'los angeles': { name: 'Los Angeles', lat: 34.0522, lng: -118.2437, region: 'US-West' },
  chicago: { name: 'Chicago', lat: 41.8781, lng: -87.6298, region: 'US-Midwest' },
  houston: { name: 'Houston', lat: 29.7604, lng: -95.3698, region: 'US-South' },
  london: { name: 'London', lat: 51.5074, lng: -0.1278, region: 'EU-UK' },
  paris: { name: 'Paris', lat: 48.8566, lng: 2.3522, region: 'EU-France' },
  berlin: { name: 'Berlin', lat: 52.52, lng: 13.405, region: 'EU-Germany' },
  tokyo: { name: 'Tokyo', lat: 35.6762, lng: 139.6503, region: 'Asia-Japan' },
  shanghai: { name: 'Shanghai', lat: 31.2304, lng: 121.4737, region: 'Asia-China' },
  beijing: { name: 'Beijing', lat: 39.9042, lng: 116.4074, region: 'Asia-China' },
  sydney: { name: 'Sydney', lat: -33.8688, lng: 151.2093, region: 'Oceania' },
  dubai: { name: 'Dubai', lat: 25.2048, lng: 55.2708, region: 'Middle-East' },
  singapore: { name: 'Singapore', lat: 1.3521, lng: 103.8198, region: 'Asia-SE' },
  'sao paulo': { name: 'São Paulo', lat: -23.5505, lng: -46.6333, region: 'SA-Brazil' },
  mumbai: { name: 'Mumbai', lat: 19.076, lng: 72.8777, region: 'Asia-India' },
  farm: { name: 'Generic Farm', lat: 35.0, lng: -90.0, region: 'US-South' },
  warehouse: { name: 'Generic Warehouse', lat: 40.0, lng: -80.0, region: 'US-East' },
  port: { name: 'Generic Port', lat: 37.8044, lng: -122.2712, region: 'US-West' },
  factory: { name: 'Generic Factory', lat: 42.0, lng: -83.0, region: 'US-Midwest' },
};

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function resolveLocation(locationStr: string): KnownLocation | null {
  if (!locationStr) return null;
  const key = locationStr.toLowerCase().trim();

  if (KNOWN_LOCATIONS[key]) return KNOWN_LOCATIONS[key];

  // Partial match
  for (const [k, loc] of Object.entries(KNOWN_LOCATIONS)) {
    if (key.includes(k) || k.includes(key)) return loc;
  }

  // Try to parse "lat,lng" format
  const coords = key.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
  if (coords) {
    return {
      name: locationStr,
      lat: parseFloat(coords[1]),
      lng: parseFloat(coords[2]),
      region: 'Unknown',
    };
  }

  return null;
}

function getSeverity(requiredSpeedKph: number): 'low' | 'medium' | 'high' | 'critical' {
  if (requiredSpeedKph > MAX_AIR_SPEED_KPH * 2) return 'critical';
  if (requiredSpeedKph > MAX_AIR_SPEED_KPH) return 'high';
  if (requiredSpeedKph > MAX_GROUND_SPEED_KPH * 3) return 'medium';
  return 'low';
}

export function detectLocationAnomalies(
  productId: string,
  events: Array<{
    eventType: string;
    timestamp: number;
    location: string;
  }>,
): LocationAnomalyResult {
  const alerts: TravelAnomalyAlert[] = [];

  if (events.length < 2) {
    return {
      productId,
      totalEvents: events.length,
      anomaliesDetected: 0,
      alerts: [],
      riskLevel: 'low',
      analysisTimestamp: new Date().toISOString(),
    };
  }

  const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

  for (let i = 1; i < sortedEvents.length; i++) {
    const prev = sortedEvents[i - 1];
    const curr = sortedEvents[i];

    if (!prev.location || !curr.location) continue;
    if (prev.location === curr.location) continue;

    const fromLoc = resolveLocation(prev.location);
    const toLoc = resolveLocation(curr.location);

    if (!fromLoc || !toLoc) continue;

    const distanceKm = haversineDistance(fromLoc.lat, fromLoc.lng, toLoc.lat, toLoc.lng);
    if (distanceKm < 10) continue; // Same metro area, ignore

    const timeBetweenSeconds = curr.timestamp - prev.timestamp;
    if (timeBetweenSeconds <= 0) {
      alerts.push({
        eventIndex: i,
        severity: 'critical',
        message: `Impossible: event at ${curr.location} occurs before or simultaneously with event at ${prev.location} (${distanceKm.toFixed(0)} km away)`,
        fromLocation: prev.location,
        toLocation: curr.location,
        timeBetweenSeconds: 0,
        distanceKm,
        requiredSpeedKph: Infinity,
        maxRealisticSpeedKph: MAX_AIR_SPEED_KPH,
      });
      continue;
    }

    const timeBetweenHours = timeBetweenSeconds / 3600;
    const requiredSpeedKph = distanceKm / timeBetweenHours;

    // Flag if impossible even by air (includes loading/unloading time buffer of 2h)
    const effectiveTimeHours = Math.max(timeBetweenHours - 2, 0.001);
    const effectiveSpeed = distanceKm / effectiveTimeHours;

    if (effectiveSpeed > MAX_GROUND_SPEED_KPH * 2) {
      const severity = getSeverity(requiredSpeedKph);
      alerts.push({
        eventIndex: i,
        severity,
        message: `Impossible travel: ${distanceKm.toFixed(0)} km from ${prev.location} to ${curr.location} in ${(timeBetweenSeconds / 3600).toFixed(2)}h (requires ${requiredSpeedKph.toFixed(0)} kph)`,
        fromLocation: prev.location,
        toLocation: curr.location,
        timeBetweenSeconds,
        distanceKm,
        requiredSpeedKph,
        maxRealisticSpeedKph: MAX_AIR_SPEED_KPH,
      });
    }
  }

  let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (alerts.some((a) => a.severity === 'critical')) riskLevel = 'critical';
  else if (alerts.some((a) => a.severity === 'high')) riskLevel = 'high';
  else if (alerts.some((a) => a.severity === 'medium')) riskLevel = 'medium';

  return {
    productId,
    totalEvents: sortedEvents.length,
    anomaliesDetected: alerts.length,
    alerts,
    riskLevel,
    analysisTimestamp: new Date().toISOString(),
  };
}
