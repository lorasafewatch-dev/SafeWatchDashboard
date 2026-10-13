import sanIsidroEast from './data/san-isidro-east.json' with { type: 'json' };

// PSA/NAMRIA mapped barangay boundary, valid 2023-11-06. GeoJSON is [lng, lat];
// Leaflet and this point-in-polygon function use [lat, lng]. The SQL trigger is
// synchronized from this same feature by scripts/sync_safe_zone.py.
export const SAN_ISIDRO_EAST_BOUNDARY = sanIsidroEast.geometry.coordinates[0]
  .map(([lng, lat]) => [lat, lng]);

export function isInsidePolygon(lat, lng, polygon = SAN_ISIDRO_EAST_BOUNDARY) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    const cross = (lng - xi) * (yj - yi) - (lat - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-10 && lng >= Math.min(xi, xj) && lng <= Math.max(xi, xj)
        && lat >= Math.min(yi, yj) && lat <= Math.max(yi, yj)) return true;
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
