import type { FlightRecord, GPSPoint } from "../flights.types";
import { calculateFlightMetrics } from "./calculateFlightMetrics";

/**
 * IGC → FlightRecord (Meta + Metrics + Track-Zeitbasis)
 */
export const parseIgcFile = (
    content: string,
    userId: number,
    originalFilename: string
): FlightRecord => {
    const lines = content.split(/\r?\n/);

    const fileHash = sha256Sync(content);
    const header = extractHeader(lines);
    const track = extractBRecords(lines);
    const lxData = extractLXNAVSpecifics(lines);

    // Metrics aktuell noch direkt aus IGC (nächster Schritt: aus track berechnen)
    const metrics = calculateFlightMetrics(content);

    const durationSeconds =
        track.length > 0 ? track[track.length - 1].tSec : null;

    const takeoffTime = track.length
        ? `${header.flightDate}T${fmtHhmmss(track[0].tAbsSec % 86400)}Z`
        : null;

    const landingTime = track.length
        ? `${header.flightDate}T${fmtHhmmss(track[track.length - 1].tAbsSec % 86400)}Z`
        : null;

    const data: FlightRecord = {
        id: 0,
        userId,

        // File / dedupe
        igcContent: content,
        fileHash,
        uploadedAt: new Date().toISOString(),
        originalFilename,

        // Header metadata
        pilotName: header.pilotName ?? null,
        gliderType: header.gliderType ?? null,
        gliderRegistration: header.gliderRegistration ?? null,
        gliderCallsign: header.gliderCallsign ?? null,
        flightDate: header.flightDate,
        loggerModel: header.loggerModel ?? null,

        // LXNAV fields
        lxDeviceJwt: lxData.jwt ?? null,
        lxActivityId: lxData.activityId ?? null,
        isVerified: Boolean(lxData.isVerified),

        // Timing (relative Zeitbasis)
        takeoffTime,
        landingTime,

        // Metrics
        durationSeconds,

        distanceKm: metrics.totalDistanceKm,

        maxAltitudeM: metrics.maxAltitudeM,
        minAltitudeM: metrics.minAltitudeM,

        maxClimbRateMs: metrics.maxClimbRateMs,
        maxSinkRateMs: metrics.maxSinkRateMs,
        avgClimbRateMs: metrics.avgClimbRateMs,

        fixCount: metrics.fixCount,

        // Visibility
        visibility: "private",
    };

    return data;
};

const fmtHhmmss = (tAbsSec: number): string => {
    const hh = Math.floor(tAbsSec / 3600);
    const mm = Math.floor((tAbsSec % 3600) / 60);
    const ss = Math.floor(tAbsSec % 60);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
};

/**
 * Intern: Extrahiert Header-Informationen
 */
const extractHeader = (lines: string[]) => {
    const findValue = (prefix: string) =>
        lines.find((l) => l.startsWith(prefix))?.split(":").pop()?.trim();

    // Datum extrahieren: HFDTE160623 -> 2023-06-16
    const dateLine = lines.find((l) => l.startsWith("HFDTE"));
    if (!dateLine || dateLine.length < 16) {
        throw new Error("IGC missing or invalid HFDTE flight date");
    }

    const d = dateLine.substring(10, 16);

    if (!/^\d{6}$/.test(d)) {
        throw new Error("IGC invalid HFDTE format");
    }

    const flightDate = `20${d.substring(4, 6)}-${d.substring(
        2,
        4
    )}-${d.substring(0, 2)}`;

    return {
        flightDate,
        pilotName: findValue("HFPLT") || findValue("HFPILOT"),
        gliderType: findValue("HFGTY") || findValue("HFGLIDERTYPE"),
        gliderRegistration: findValue("HFGID") || findValue("HFGLIDERID"),
        gliderCallsign: findValue("HFCID") || findValue("HFCOMPETITIONID"),
        loggerModel: findValue("HFFTY"),
    };
};

/**
 * Intern: Extrahiert GPS-Fixes
 * Liefert:
 * - tAbsSec = Sekunden seit Mitternacht (IGC)
 * - tSec    = Sekunden seit Start (relativ)
 */
const extractBRecords = (lines: string[]): GPSPoint[] => {
    let t0Abs: number | null = null;     // Startzeit (in korrigierten Abs-Sekunden)
    let lastAbs: number | null = null;   // letzte rohe Abs-Zeit (0..86399)
    let dayOffset = 0;                   // 0, 86400, 172800, ...

    return lines
        .filter((line) => line.startsWith("B") && line.length >= 35)
        .map((line) => {
            const rawTime = line.substring(1, 7); // "HHMMSS"
            const tAbsRaw = parseTimeSec(rawTime); // 0..86399


            // 🔁 Rollover: wenn Uhrzeit zurückspringt, sind wir im nächsten Tag
            if (lastAbs !== null && tAbsRaw < lastAbs) {
                dayOffset += 86400;
            }
            lastAbs = tAbsRaw;

            const tAbsSec = tAbsRaw + dayOffset; // korrigiert, monoton über Mitternacht

            // Startzeit setzen
            if (t0Abs === null) {
                t0Abs = tAbsSec;
            }

            const tSec = tAbsSec - t0Abs; // Sekunden seit Start, monoton

            // Altitude: GNSS bevorzugen, sonst Druckhöhe (wie in calculateFlightMetrics)
            const pressureAlt = Number(line.slice(25, 30));
            const gnssAlt = Number(line.slice(30, 35));
            const alt =
                !Number.isNaN(gnssAlt) && gnssAlt > 0
                    ? gnssAlt
                    : pressureAlt;

            return {
                tAbsSec,
                tSec,
                lat: parseIgcCoordinate(line.substring(7, 15)),
                lng: parseIgcCoordinate(line.substring(15, 24)),
                alt,
            };
        });
};


/**
 * HHMMSS -> Sekunden seit Mitternacht
 */
const parseTimeSec = (hhmmss: string): number => {
    const hh = Number(hhmmss.slice(0, 2));
    const mm = Number(hhmmss.slice(2, 4));
    const ss = Number(hhmmss.slice(4, 6));
    return hh * 3600 + mm * 60 + ss;
};

/**
 * Umrechnung der IGC Koordinaten (DDMMmmmN / DDDMMmmmE) in Dezimalgrad
 */
const parseIgcCoordinate = (raw: string): number => {
    const isNegative = raw.endsWith("S") || raw.endsWith("W");
    const numeric = raw.substring(0, raw.length - 1);
    const splitPos = raw.length === 8 ? 2 : 3;
    const deg = parseInt(numeric.substring(0, splitPos), 10);
    const min = parseInt(numeric.substring(splitPos), 10) / 1000 / 60;
    return (deg + min) * (isNegative ? -1 : 1);
};

/**
 * LXNAV Spezifika aus L-Records oder G-Record extrahieren
 */
const extractLXNAVSpecifics = (lines: string[]) => ({
    jwt:
        lines
            .find((l) => l.includes("LXCTDEVICE"))
            ?.split(":")
            .pop()
            ?.trim() || null,
    activityId:
        lines
            .find((l) => l.includes("LXCTACTIVITY"))
            ?.split(":")
            .pop()
            ?.trim() || null,
    isVerified: lines.some((l) => l.startsWith("G")),
});

/**
 * Berechnet einfache Statistiken aus dem Track
 * (nutzt relative Zeitbasis)
 */
export const calculateFlightStats = (track: GPSPoint[]) => {
    if (track.length < 2) {
        return { durationSeconds: 0, maxAltitude: 0, distanceKm: 0 };
    }

    const durationSeconds = track[track.length - 1].tSec;
    const maxAlt = Math.max(...track.map((p) => p.alt));

    let dist = 0;
    for (let i = 1; i < track.length; i++) {
        const p1 = track[i - 1];
        const p2 = track[i];
        const R = 6371;
        const dLat = ((p2.lat - p1.lat) * Math.PI) / 180;
        const dLon = ((p2.lng - p1.lng) * Math.PI) / 180;
        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos((p1.lat * Math.PI) / 180) *
            Math.cos((p2.lat * Math.PI) / 180) *
            Math.sin(dLon / 2) ** 2;
        dist += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    return {
        durationSeconds: Math.floor(durationSeconds),
        maxAltitude: maxAlt,
        distanceKm: Math.round(dist * 100) / 100,
    };
};

/**
 * SHA-256 (sync, browser-safe)
 */
const sha256Sync = (message: string): string => {
    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    const lengthProperty = "length";
    let i: number, j: number;
    let result = "";

    const messageOctets = unescape(encodeURIComponent(message));
    const messageLength = messageOctets[lengthProperty];

    // Statische Speicher für Primes (Cache)
    const hash: number[] = ((sha256Sync as any).h =
        (sha256Sync as any).h || []);
    const k: number[] = ((sha256Sync as any).k =
        (sha256Sync as any).k || []);
    let primeCounter = k[lengthProperty];

    const isPrime = (n: number): boolean => {
        for (let factor = 2; factor * factor <= n; factor++) {
            if (n % factor === 0) return false;
        }
        return true;
    };

    if (!primeCounter) {
        let candidate = 2;
        while (primeCounter < 64) {
            if (isPrime(candidate)) {
                if (primeCounter < 8) {
                    hash[primeCounter] =
                        (mathPow(candidate, 1 / 2) * maxWord) | 0;
                }
                k[primeCounter] =
                    (mathPow(candidate, 1 / 3) * maxWord) | 0;
                primeCounter++;
            }
            candidate++;
        }
    }

    const hashState = [...hash];

    const words_copy: number[] = [];
    for (i = 0; i < messageLength; i++) {
        const index = i >> 2;
        words_copy[index] =
            (words_copy[index] || 0) |
            (messageOctets.charCodeAt(i) <<
                (24 - (i % 4) * 8));
    }

    const bitLength = messageLength * 8;
    const lastIndex = messageLength >> 2;
    words_copy[lastIndex] =
        (words_copy[lastIndex] || 0) |
        (0x80 << (24 - (messageLength % 4) * 8));

    const finalLengthIndex =
        (((messageLength + 8) >> 6) << 4) + 15;
    while (words_copy.length < finalLengthIndex) {
        words_copy.push(0);
    }
    words_copy[finalLengthIndex] = bitLength;

    for (i = 0; i < words_copy.length; i += 16) {
        const w = words_copy.slice(i, i + 16);
        for (let fill = w.length; fill < 64; fill++) w[fill] = 0;

        const oldHash = [...hashState];

        for (j = 0; j < 64; j++) {
            if (j >= 16) {
                const s0 =
                    ((w[j - 15] >>> 7) | (w[j - 15] << 25)) ^
                    ((w[j - 15] >>> 18) | (w[j - 15] << 14)) ^
                    (w[j - 15] >>> 3);
                const s1 =
                    ((w[j - 2] >>> 17) | (w[j - 2] << 15)) ^
                    ((w[j - 2] >>> 19) | (w[j - 2] << 13)) ^
                    (w[j - 2] >>> 10);
                w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
            }

            const t1 =
                (hashState[7] +
                    (((hashState[4] >>> 6) |
                        (hashState[4] << 26)) ^
                        ((hashState[4] >>> 11) |
                            (hashState[4] << 21)) ^
                        ((hashState[4] >>> 25) |
                            (hashState[4] << 7))) +
                    ((hashState[4] & hashState[5]) ^
                        (~hashState[4] & hashState[6])) +
                    k[j] +
                    w[j]) |
                0;
            const t2 =
                ((((hashState[0] >>> 2) |
                    (hashState[0] << 30)) ^
                    ((hashState[0] >>> 13) |
                        (hashState[0] << 19)) ^
                    ((hashState[0] >>> 22) |
                        (hashState[0] << 10))) +
                    ((hashState[0] & hashState[1]) ^
                        (hashState[0] & hashState[2]) ^
                        (hashState[1] & hashState[2]))) |
                0;

            hashState[7] = hashState[6];
            hashState[6] = hashState[5];
            hashState[5] = hashState[4];
            hashState[4] = (hashState[3] + t1) | 0;
            hashState[3] = hashState[2];
            hashState[2] = hashState[1];
            hashState[1] = hashState[0];
            hashState[0] = (t1 + t2) | 0;
        }

        for (j = 0; j < 8; j++) {
            hashState[j] =
                (hashState[j] + oldHash[j]) | 0;
        }
    }

    for (i = 0; i < 8; i++) {
        const s = (hashState[i] >>> 0).toString(16);
        result += s.padStart(8, "0");
    }

    return result;
};
