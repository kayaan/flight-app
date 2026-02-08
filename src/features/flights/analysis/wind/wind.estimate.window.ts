import type { WindConfig, WindEstimate } from "./wind.types";
import { clamp, dirFromVecDeg, normalize, projectMeters, vecLen } from "./wind.math";

type WindFix = {
    tSec: number;
    lat: number;
    lon: number;
};

/**
 * Estimate wind from a time window [startSec..endSec] using an assumed airspeed:
 *
 *   groundVelocity ≈ wind + airspeed * headingUnit
 *   => wind ≈ mean(groundVelocity - airspeed * headingUnit)
 *
 * Notes:
 * - "dirDeg" is the direction the wind is blowing TO (drift direction).
 * - This is a rough estimate; quality is heuristic.
 */
export function estimateWindFromWindow(
    fixes: WindFix[],
    startSec: number,
    endSec: number,
    config: WindConfig
): WindEstimate | null {
    if (fixes.length < 2) return null;

    const aSec = Math.min(startSec, endSec);
    const bSec = Math.max(startSec, endSec);

    // Collect indices within the window (simple scan; OK for now)
    // (We can optimize to binary search later if needed.)
    let startIdx = -1;
    let endIdx = -1;
    for (let i = 0; i < fixes.length; i++) {
        const t = fixes[i].tSec;
        if (t >= aSec && startIdx === -1) startIdx = i;
        if (t <= bSec) endIdx = i;
    }
    if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) return null;

    // Reference point for local projection (use midpoint fix)
    const midIdx = (startIdx + endIdx) >> 1;
    const refLat = fixes[midIdx].lat;
    const refLon = fixes[midIdx].lon;

    const Va = config.airspeedKmh / 3.6; // m/s

    let sumWx = 0;
    let sumWy = 0;
    let used = 0;

    for (let i = startIdx; i < endIdx; i++) {
        const p0 = fixes[i];
        const p1 = fixes[i + 1];

        const dt = p1.tSec - p0.tSec;
        if (dt <= 0.001) continue;

        const a = projectMeters(p0.lat, p0.lon, refLat, refLon);
        const b = projectMeters(p1.lat, p1.lon, refLat, refLon);

        // Ground velocity vector (east=x, north=y)
        const gx = (b.x - a.x) / dt;
        const gy = (b.y - a.y) / dt;

        const gSpeed = vecLen(gx, gy);
        if (!Number.isFinite(gSpeed) || gSpeed < config.minGroundSpeedMs) continue;

        const h = normalize(gx, gy);
        if (!h) continue;

        // wind = ground - airspeed * heading
        const wx = gx - Va * h.x;
        const wy = gy - Va * h.y;

        if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;

        sumWx += wx;
        sumWy += wy;
        used++;
    }

    if (used < 4) return null;

    const meanWx = sumWx / used;
    const meanWy = sumWy / used;

    const speedMs = vecLen(meanWx, meanWy);
    const dirDeg = dirFromVecDeg(meanWx, meanWy);

    // Heuristic quality: more samples => better, capped.
    // (We will improve this later when we add method B.)
    const quality = clamp(used / 40, 0, 1);

    return {
        method: "window",
        dirDeg,
        speedMs,
        quality,
        sampleCount: used,
    };
}
