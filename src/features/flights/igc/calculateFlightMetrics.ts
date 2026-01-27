import type { FlightMetrics } from "./igc.types";

// 🔧 Performance-Optimierung (Sampling, Noise-Filter)

// 📈 Thermik-Erkennung

// 🗺️ Höhenprofil-Daten fürs Frontend

// 🧪 Vitest-Tests mit echter IGC

export type FlightMetricsOptions = {
    /** Zeitfenster in Sekunden für Steig-/Sinkraten-Glättung (Default: 5s) */
    rateWindowSec?: number;
};

export function calculateFlightMetrics(
    igc: string,
    options: FlightMetricsOptions = {})
    : FlightMetrics {

    const RATE_WINDOW = options.rateWindowSec ?? 5;

    type Fix = {
        timeSec: number;     // Zeit in Sekunden seit Mitternacht
        lat: number;         // Latitude in Dezimalgrad
        lon: number;         // Longitude in Dezimalgrad
        altitude: number;    // Höhe in Metern (MSL)
    };

    const fixes: Fix[] = [];

    let sumPositiveRates = 0;
    let positiveRateWindows = 0;

    const lines = igc.split('\n');

    for (const line of lines) {
        // Nur B-Records enthalten Trackpunkte
        if (!line.startsWith('B') || line.length < 35) continue;

        try {
            // Zeit HHMMSS
            const hh = Number(line.slice(1, 3));
            const mm = Number(line.slice(3, 5));
            const ss = Number(line.slice(5, 7));
            const timeSec = hh * 3600 + mm * 60 + ss;

            // Latitude DDMMmmmN/S
            const latDeg = Number(line.slice(7, 9));
            const latMin = Number(line.slice(9, 11));
            const latMinFrac = Number(line.slice(11, 14));
            const latHem = line[14];

            let lat =
                latDeg + (latMin + latMinFrac / 1000) / 60;
            if (latHem === 'S') lat *= -1;

            // Longitude DDDMMmmmE/W
            const lonDeg = Number(line.slice(15, 18));
            const lonMin = Number(line.slice(18, 20));
            const lonMinFrac = Number(line.slice(20, 23));
            const lonHem = line[23];

            let lon =
                lonDeg + (lonMin + lonMinFrac / 1000) / 60;
            if (lonHem === 'W') lon *= -1;

            // Höhen:
            // Druckhöhe (Axxxx) und GNSS-Höhe (Gyyyyy)
            const pressureAlt = Number(line.slice(25, 30));
            const gnssAlt = Number(line.slice(30, 35));

            // GNSS bevorzugen, falls sinnvoll
            const altitude =
                !Number.isNaN(gnssAlt) && gnssAlt > 0
                    ? gnssAlt
                    : pressureAlt;

            fixes.push({ timeSec, lat, lon, altitude });
        } catch {
            // Kaputte Zeile ignorieren
            continue;
        }
    }

    if (fixes.length < 2) {
        throw new Error('Nicht genügend gültige Trackpunkte');
    }

    const distanceKm = (a: Fix, b: Fix): number => {
        const R = 6371; // Erdradius in km
        const toRad = (v: number) => (v * Math.PI) / 180;

        const dLat = toRad(b.lat - a.lat);
        const dLon = toRad(b.lon - a.lon);

        const lat1 = toRad(a.lat);
        const lat2 = toRad(b.lat);

        const h =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon / 2) ** 2;

        return 2 * R * Math.asin(Math.sqrt(h));
    };

    let totalDistanceKm = 0;
    let maxAltitude = -Infinity;
    let minAltitude = Infinity;

    let maxClimbRate = 0;
    let maxSinkRate = 0;

    let totalAltitudeGain = 0;

    let windowAlt = 0;
    let windowTime = 0;

    for (let i = 1; i < fixes.length; i++) {
        const prev = fixes[i - 1];
        const curr = fixes[i];

        totalDistanceKm += distanceKm(prev, curr);

        maxAltitude = Math.max(maxAltitude, curr.altitude);
        minAltitude = Math.min(minAltitude, curr.altitude);

        const deltaAlt = curr.altitude - prev.altitude;
        const deltaTime = curr.timeSec - prev.timeSec;

        if (deltaAlt > 0) totalAltitudeGain += deltaAlt;

        if (deltaTime > 0) {
            windowAlt += deltaAlt;
            windowTime += deltaTime;

            // erst auswerten, wenn wir genug Zeit gesammelt haben
            if (windowTime >= RATE_WINDOW) {
                const rate = windowAlt / windowTime;

                if (rate > 0) {
                    maxClimbRate = Math.max(maxClimbRate, rate);
                    sumPositiveRates += rate;
                    positiveRateWindows++;
                }
                if (rate < 0) maxSinkRate = Math.min(maxSinkRate, rate);

                // Fenster zurücksetzen
                windowAlt = 0;
                windowTime = 0;
            }
        }
    }

    const avgPositiveClimbRateMs =
        positiveRateWindows > 0 ? sumPositiveRates / positiveRateWindows : 0;

    return {
        totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
        maxAltitudeM: Math.round(maxAltitude),
        minAltitudeM: Math.round(minAltitude),
        totalAltitudeGainM: Math.round(totalAltitudeGain),
        maxClimbRateMs: Number(maxClimbRate.toFixed(2)),
        maxSinkRateMs: Number(maxSinkRate.toFixed(2)),
        startAltitudeM: Math.round(fixes[0].altitude),
        landingAltitudeM: Math.round(fixes[fixes.length - 1].altitude),
        avgClimbRateMs: Number(avgPositiveClimbRateMs.toFixed(2)),
        fixCount: fixes.length
    };
}
