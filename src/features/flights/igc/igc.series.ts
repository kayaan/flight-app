import type { FixPoint, SeriesPoint, WindowPoint } from "./igc.series.types";

/**
 * Earth radius in kilometers.
 */
const EARTH_RADIUS_KM = 6371;

/**
 * Convert degrees to radians.
 */
function toRad(v: number): number {
    return (v * Math.PI) / 180;
}

export const calculationWindow = 5;

/**
 * Haversine distance between two lat/lon points in kilometers.
 */
function haversineKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * Basic validation for IGC B-record lines.
 */
function isValidBRecord(line: string): boolean {
    return line.startsWith("B") && line.length >= 35;
}

/**
 * Build an ISO timestamp from flight date + HHMMSS.
 */
function buildIsoTimestamp(
    flightDate: string,
    hh: number,
    mm: number,
    ss: number
): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${flightDate}T${pad(hh)}:${pad(mm)}:${pad(ss)}Z`;
}

// ---- Public API (still unimplemented) ----

export function parseIgcFixes(
    igc: string,
    flightDate: string
): FixPoint[] {
    const fixes: FixPoint[] = [];
    const lines = igc.split(/\r?\n/);

    for (const line of lines) {
        if (!isValidBRecord(line)) continue;

        // Time HHMMSS
        const hh = Number(line.slice(1, 3));
        const mm = Number(line.slice(3, 5));
        const ss = Number(line.slice(5, 7));
        const tSec = hh * 3600 + mm * 60 + ss;

        // Latitude DDMMmmmN/S
        const latDeg = Number(line.slice(7, 9));
        const latMin = Number(line.slice(9, 11));
        const latMinFrac = Number(line.slice(11, 14));
        const latHem = line[14];

        let lat = latDeg + (latMin + latMinFrac / 1000) / 60;
        if (latHem === "S") lat *= -1;

        // Longitude DDDMMmmmE/W
        const lonDeg = Number(line.slice(15, 18));
        const lonMin = Number(line.slice(18, 20));
        const lonMinFrac = Number(line.slice(20, 23));
        const lonHem = line[23];

        let lon = lonDeg + (lonMin + lonMinFrac / 1000) / 60;
        if (lonHem === "W") lon *= -1;

        // Altitudes:
        // pressure altitude (Axxxx) at [25..30), GNSS altitude at [30..35)
        const pressureAlt = Number(line.slice(25, 30));
        const gnssAlt = Number(line.slice(30, 35));

        const altitudeM =
            Number.isFinite(gnssAlt) && gnssAlt > 0 ? gnssAlt : pressureAlt;

        const iso = buildIsoTimestamp(flightDate, hh, mm, ss);

        // Skip broken records
        if (
            !Number.isFinite(tSec) ||
            !Number.isFinite(lat) ||
            !Number.isFinite(lon) ||
            !Number.isFinite(altitudeM)
        ) {
            continue;
        }

        fixes.push({ tSec, iso, lat, lon, altitudeM });
    }

    // Ensure chronological order
    fixes.sort((a, b) => a.tSec - b.tSec);

    return fixes;
}

export function buildFlightSeries(
    fixes: FixPoint[],
    windowSec: number = calculationWindow
): {
    series: SeriesPoint[];
    windows: WindowPoint[];
} {
    if (fixes.length < 2) return { series: [], windows: [] };

    // Defensive default
    if (!Number.isFinite(windowSec) || windowSec <= 0) windowSec = 5;

    const startT = fixes[0].tSec;

    // 1) Per-fix series (altitude + instantaneous ground speed)
    const series: SeriesPoint[] = [];
    for (let i = 0; i < fixes.length; i++) {
        const f = fixes[i];

        let gSpeedKmh = 0;
        if (i > 0) {
            const p = fixes[i - 1];
            const dt = f.tSec - p.tSec;
            if (dt > 0) {
                const dk = haversineKm(p.lat, p.lon, f.lat, f.lon);
                gSpeedKmh = dk / (dt / 3600); // km/h
            }
        }

        series.push({
            tSec: f.tSec - startT,
            altitudeM: f.altitudeM,
            gSpeedKmh,
        });
    }

    // 2) Discrete window-based series (bars)
    const windows: WindowPoint[] = [];
    let i = 0;

    while (i < fixes.length - 1) {
        const wStart = fixes[i];
        const targetEndT = wStart.tSec + windowSec;

        // Find last index within the window
        let j = i;
        while (j + 1 < fixes.length && fixes[j + 1].tSec <= targetEndT) j++;

        // If the window doesn't progress, move forward
        if (j === i) {
            i++;
            continue;
        }

        const wEnd = fixes[j];
        const dt = wEnd.tSec - wStart.tSec;

        // Guard
        if (dt <= 0) {
            i = j + 1;
            continue;
        }

        // Vertical speed over the window (m/s)
        const dAlt = wEnd.altitudeM - wStart.altitudeM;
        const vSpeedMs = dAlt / dt;

        // Horizontal speed averaged over the same window:
        // total distance / total time
        let distKm = 0;
        for (let k = i + 1; k <= j; k++) {
            const a = fixes[k - 1];
            const b = fixes[k];
            distKm += haversineKm(a.lat, a.lon, b.lat, b.lon);
        }
        const gSpeedKmh = distKm / (dt / 3600);

        windows.push({
            tSec: wEnd.tSec - startT, // window end, relative to takeoff
            vSpeedMs,
            gSpeedKmh,
        });

        // Next window starts after this one
        i = j + 1;
    }

    return { series, windows };
}