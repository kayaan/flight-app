// Math + geo helpers for wind estimation.
// Keep this file pure (no React, no Leaflet).

export function clamp(n: number, min: number, max: number) {
    return Math.min(max, Math.max(min, n));
}

export function deg2rad(d: number) {
    return (d * Math.PI) / 180;
}

export function rad2deg(r: number) {
    return (r * 180) / Math.PI;
}

/**
 * Bearing in degrees: 0° = North, 90° = East.
 */
export function bearingDeg(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
    const φ1 = deg2rad(fromLat);
    const φ2 = deg2rad(toLat);
    const Δλ = deg2rad(toLon - fromLon);

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

    const θ = Math.atan2(y, x);
    return (rad2deg(θ) + 360) % 360;
}

/**
 * Local equirectangular projection (meters) around a reference point.
 * Good enough for small areas (single flight).
 */
export function projectMeters(
    lat: number,
    lon: number,
    refLat: number,
    refLon: number
): { x: number; y: number } {
    const R = 6371000; // meters
    const φ = deg2rad(lat);
    const φ0 = deg2rad(refLat);
    const λ = deg2rad(lon);
    const λ0 = deg2rad(refLon);

    const x = (λ - λ0) * Math.cos(φ0) * R; // east
    const y = (φ - φ0) * R; // north
    return { x, y };
}

/**
 * Convert local meters back to lat/lon using the same reference.
 */
export function unprojectMeters(
    x: number,
    y: number,
    refLat: number,
    refLon: number
): { lat: number; lon: number } {
    const R = 6371000;
    const φ0 = deg2rad(refLat);
    const λ0 = deg2rad(refLon);

    const φ = y / R + φ0;
    const λ = x / (R * Math.cos(φ0)) + λ0;

    return { lat: rad2deg(φ), lon: rad2deg(λ) };
}

export function vecLen(x: number, y: number) {
    return Math.hypot(x, y);
}

/**
 * Convert an (east, north) vector into a direction (degrees),
 * where 0° = North, 90° = East.
 */
export function dirFromVecDeg(xEast: number, yNorth: number) {
    const θ = Math.atan2(xEast, yNorth);
    return (rad2deg(θ) + 360) % 360;
}

export function normalize(x: number, y: number): { x: number; y: number } | null {
    const L = Math.hypot(x, y);
    if (L <= 1e-9) return null;
    return { x: x / L, y: y / L };
}

/**
 * Smallest absolute angular difference (0..180).
 */
export function angleDiffDeg(a: number, b: number) {
    const d = Math.abs(((a - b + 540) % 360) - 180);
    return d;
}
