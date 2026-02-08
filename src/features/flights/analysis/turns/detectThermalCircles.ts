// src/features/flights/analysis/turns/detectThermalCircles.ts
import type { FixPoint } from "../../igc";

/**
 * Minimal shape of your climb phases.
 * We support either indices or times.
 */
export type ClimbPhaseLike =
    | { startIdx: number; endIdx: number; startSec?: number; endSec?: number }
    | { startSec: number; endSec: number; startIdx?: number; endIdx?: number };

export type ThermalCircle = {
    startIdx: number;
    endIdx: number;
    startSec: number;
    endSec: number;

    // drift vector = "wind on ground" estimate (from start->end over dt)
    driftVxMs: number; // +x east (m/s)
    driftVyMs: number; // +y north (m/s)

    windSpeedMs: number;
    windDirDeg: number; // direction blowing TO (0=N, 90=E)

    // diagnostics
    turnDeg: number;
    rMeanM: number;
    rStdM: number;
    quality: number;
};

export type DetectThermalCirclesConfig = {
    // Sliding window (1Hz fixes assumed)
    windowPts: number; // e.g. 60
    stepPts: number;   // e.g. 8

    // Circle requirements (after detrending drift)
    minTurnDeg: number; // e.g. 300
    minRadiusM: number; // e.g. 30
    maxRadiusM: number; // e.g. 100 (you can widen)
    maxRadiusSlackM?: number; // small tolerance buffer

    maxRadiusRelStd: number; // e.g. 0.35

    // Direction consistency: fraction of deltas that match dominant sign
    minSignConsistency: number; // e.g. 0.70

    // optional climb gating inside the window
    minAltGainM?: number; // e.g. 30..60

    // merging
    mergeGapPts: number; // e.g. 10
    backtrackPts: number; // trimming helper, e.g. 6

    // keep only "best" circles per climb if too many (optional)
    maxCirclesPerClimb?: number;
};

export const defaultThermalCirclesConfig: DetectThermalCirclesConfig = {
    windowPts: 60,
    stepPts: 8,

    minTurnDeg: 300,

    minRadiusM: 30,
    maxRadiusM: 100,
    maxRadiusSlackM: 40, // allow drift/noise; effective max = maxRadiusM + slack

    maxRadiusRelStd: 0.35,
    minSignConsistency: 0.70,

    minAltGainM: 30,

    mergeGapPts: 10,
    backtrackPts: 6,

    maxCirclesPerClimb: 12,
};

// ----------------------------
// Helpers (no wind.math)
// ----------------------------
function clamp(n: number, a: number, b: number) {
    return Math.min(b, Math.max(a, n));
}

function toRad(d: number) {
    return (d * Math.PI) / 180;
}
function toDeg(r: number) {
    return (r * 180) / Math.PI;
}

// signed smallest delta (-PI..PI)
function signedDeltaRad(a: number, b: number) {
    const d = b - a;
    return ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}

/**
 * Fast local meters projection (equirectangular around ref).
 * Good enough for thermals (100m scale).
 */
function projectLocalMeters(lat: number, lon: number, refLat: number, refLon: number) {
    const R = 6371000;
    const φ = toRad(lat);
    const φ0 = toRad(refLat);
    const dφ = φ - φ0;
    const dλ = toRad(lon - refLon);
    const x = dλ * Math.cos(φ0) * R; // east
    const y = dφ * R;               // north
    return { x, y };
}

function windDirDegFromV(vx: number, vy: number) {
    // vx east, vy north; 0=N,90=E
    const deg = (toDeg(Math.atan2(vx, vy)) + 360) % 360;
    return deg;
}

function meanXY(pts: Array<{ x: number; y: number }>) {
    let sx = 0, sy = 0;
    const n = pts.length || 1;
    for (const p of pts) { sx += p.x; sy += p.y; }
    return { cx: sx / n, cy: sy / n };
}

function radiusStats(pts: Array<{ x: number; y: number }>, cx: number, cy: number) {
    const n = pts.length || 1;
    let s = 0;
    let s2 = 0;
    for (const p of pts) {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const r = Math.hypot(dx, dy);
        s += r;
        s2 += r * r;
    }
    const mean = s / n;
    const varr = Math.max(0, s2 / n - mean * mean);
    const std = Math.sqrt(varr);
    return { mean, std };
}

function resolveClimbToIdxRange(fixes: FixPoint[], c: ClimbPhaseLike): { s: number; e: number } | null {
    const n = fixes.length;
    if (n < 2) return null;

    const hasIdx = (x: any): x is { startIdx: number; endIdx: number } =>
        typeof x?.startIdx === "number" && typeof x?.endIdx === "number";

    if (hasIdx(c)) {
        const s = clamp(Math.min(c.startIdx, c.endIdx), 0, n - 2);
        const e = clamp(Math.max(c.startIdx, c.endIdx), s + 1, n - 1);
        return { s, e };
    }

    // fallback by time -> idx scan (simple, n is manageable)
    const sSec = Math.min((c as any).startSec ?? 0, (c as any).endSec ?? 0);
    const eSec = Math.max((c as any).startSec ?? 0, (c as any).endSec ?? 0);

    let s = 0;
    while (s < n && fixes[s].tSec < sSec) s++;
    let e = n - 1;
    while (e > 0 && fixes[e].tSec > eSec) e--;

    s = clamp(s, 0, n - 2);
    e = clamp(e, s + 1, n - 1);
    return { s, e };
}

type WindowEval = {
    startIdx: number;
    endIdx: number;
    turnDeg: number;
    rMeanM: number;
    rStdM: number;
    signConsistency: number;
    driftVxMs: number;
    driftVyMs: number;
    quality: number;
};

function evalWindow(
    fixes: FixPoint[],
    startIdx: number,
    endIdx: number,
    cfg: DetectThermalCirclesConfig
): WindowEval | null {
    if (endIdx <= startIdx + 3) return null;

    const a = fixes[startIdx];
    const b = fixes[endIdx];
    const dt = b.tSec - a.tSec;
    if (!(dt > 0.5)) return null;

    // optional climb gating
    if (typeof cfg.minAltGainM === "number") {
        const gain = b.altitudeM - a.altitudeM;
        if (gain < cfg.minAltGainM) return null;
    }

    const refLat = a.lat;
    const refLon = a.lon;

    // project segment to local meters
    const pts: Array<{ t: number; x: number; y: number }> = [];
    pts.length = endIdx - startIdx + 1;

    for (let i = startIdx; i <= endIdx; i++) {
        const f = fixes[i];
        const p = projectLocalMeters(f.lat, f.lon, refLat, refLon);
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
        pts[i - startIdx] = { t: f.tSec, x: p.x, y: p.y };
    }

    // drift estimate from start->end over dt
    const vx = (pts[pts.length - 1].x - pts[0].x) / dt; // east m/s
    const vy = (pts[pts.length - 1].y - pts[0].y) / dt; // north m/s

    // detrend: p' = p - v*(t - t0)
    const t0 = pts[0].t;
    const detr: Array<{ x: number; y: number }> = new Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
        const tt = pts[i].t - t0;
        detr[i] = { x: pts[i].x - vx * tt, y: pts[i].y - vy * tt };
    }

    // centroid + radius stats
    const { cx, cy } = meanXY(detr);
    const { mean: rMean, std: rStd } = radiusStats(detr, cx, cy);

    const maxR = cfg.maxRadiusM + (cfg.maxRadiusSlackM ?? 0);

    if (!Number.isFinite(rMean) || !Number.isFinite(rStd)) return null;
    if (rMean < cfg.minRadiusM || rMean > maxR) return null;

    const relStd = rMean > 1e-6 ? rStd / rMean : 999;
    if (relStd > cfg.maxRadiusRelStd) return null;

    // unwrap angles and measure sign consistency
    let total = 0;
    let pos = 0;
    let neg = 0;

    let prevAng = Math.atan2(detr[0].y - cy, detr[0].x - cx);
    for (let i = 1; i < detr.length; i++) {
        const ang = Math.atan2(detr[i].y - cy, detr[i].x - cx);
        const d = signedDeltaRad(prevAng, ang);
        total += d;

        if (d > 0) pos++;
        else if (d < 0) neg++;

        prevAng = ang;
    }

    const turnDeg = Math.abs(toDeg(total));
    if (turnDeg < cfg.minTurnDeg) return null;

    const steps = Math.max(1, pos + neg);
    const dominant = Math.max(pos, neg);
    const signConsistency = dominant / steps;
    if (signConsistency < cfg.minSignConsistency) return null;

    // quality heuristic
    const qTurn = clamp((turnDeg - cfg.minTurnDeg) / 120 + 0.5, 0, 1);
    const qRad = clamp(1 - relStd / cfg.maxRadiusRelStd, 0, 1);
    const qSign = clamp((signConsistency - cfg.minSignConsistency) / (1 - cfg.minSignConsistency), 0, 1);

    const quality = clamp(0.45 * qTurn + 0.35 * qRad + 0.20 * qSign, 0, 1);

    return {
        startIdx,
        endIdx,
        turnDeg,
        rMeanM: rMean,
        rStdM: rStd,
        signConsistency,
        driftVxMs: vx,
        driftVyMs: vy,
        quality,
    };
}

function mergeIntervals(intervals: Array<{ s: number; e: number }>, gap: number) {
    if (intervals.length === 0) return [];
    const sorted = [...intervals].sort((a, b) => a.s - b.s);
    const out: Array<{ s: number; e: number }> = [];
    let cur = { ...sorted[0] };

    for (let i = 1; i < sorted.length; i++) {
        const it = sorted[i];
        if (it.s <= cur.e + gap) {
            cur.e = Math.max(cur.e, it.e);
        } else {
            out.push(cur);
            cur = { ...it };
        }
    }
    out.push(cur);
    return out;
}

/**
 * Main entry:
 * - for each climb phase:
 *   - slide window, accept "circle windows"
 *   - merge windows into segments
 *   - optional trimming not too aggressive (keeps detection robust)
 */
export function detectThermalCirclesInClimbs(
    fixes: FixPoint[],
    climbs: ClimbPhaseLike[],
    partialCfg: Partial<DetectThermalCirclesConfig> = {}
): ThermalCircle[] {
    const cfg: DetectThermalCirclesConfig = { ...defaultThermalCirclesConfig, ...partialCfg };
    if (!fixes || fixes.length < 10) return [];
    if (!climbs || climbs.length === 0) return [];

    const results: ThermalCircle[] = [];

    for (const c of climbs) {
        const r = resolveClimbToIdxRange(fixes, c);
        if (!r) continue;
        const cs = r.s;
        const ce = r.e;

        if (ce - cs + 1 < cfg.windowPts) continue;

        const acceptedWindows: WindowEval[] = [];

        for (let i = cs; i + cfg.windowPts <= ce; i += cfg.stepPts) {
            const s = i;
            const e = i + cfg.windowPts;

            const ev = evalWindow(fixes, s, e, cfg);
            if (ev) acceptedWindows.push(ev);
        }

        if (acceptedWindows.length === 0) continue;

        // Merge by indices
        const merged = mergeIntervals(
            acceptedWindows.map((w) => ({ s: w.startIdx, e: w.endIdx })),
            cfg.mergeGapPts
        );

        // For each merged segment, pick best window inside it (for drift/wind vector)
        const circlesThisClimb: ThermalCircle[] = [];

        for (const seg of merged) {
            const s = seg.s;
            const e = seg.e;

            // choose best eval inside [s..e]
            let best: WindowEval | null = null;
            for (const w of acceptedWindows) {
                if (w.startIdx >= s && w.endIdx <= e) {
                    if (!best || w.quality > best.quality) best = w;
                }
            }
            if (!best) continue;

            // light trimming: backtrack a bit from ends to avoid over-merge
            const trim = cfg.backtrackPts;
            const s2 = clamp(s + Math.floor(trim / 2), cs, ce - 2);
            const e2 = clamp(e - Math.floor(trim / 2), s2 + 2, ce);

            const a = fixes[s2];
            const b = fixes[e2];
            const dt = Math.max(0.001, b.tSec - a.tSec);

            // wind from segment start->end
            const refLat = a.lat;
            const refLon = a.lon;
            const pA = projectLocalMeters(a.lat, a.lon, refLat, refLon); // (0,0)
            const pB = projectLocalMeters(b.lat, b.lon, refLat, refLon);

            const dx = pB.x - pA.x;
            const dy = pB.y - pA.y;

            const vx = dx / dt;
            const vy = dy / dt;

            const windSpeed = Math.hypot(vx, vy);
            const windDir = windDirDegFromV(vx, vy);

            circlesThisClimb.push({
                startIdx: s2,
                endIdx: e2,
                startSec: a.tSec,
                endSec: b.tSec,
                driftVxMs: vx,
                driftVyMs: vy,
                windSpeedMs: windSpeed,
                windDirDeg: windDir,
                turnDeg: best.turnDeg,
                rMeanM: best.rMeanM,
                rStdM: best.rStdM,
                quality: best.quality,
            });
        }

        // optional cap
        if (typeof cfg.maxCirclesPerClimb === "number" && circlesThisClimb.length > cfg.maxCirclesPerClimb) {
            circlesThisClimb.sort((a, b) => b.quality - a.quality);
            circlesThisClimb.length = cfg.maxCirclesPerClimb;
        }

        results.push(...circlesThisClimb);
    }

    // final: merge overlaps across climbs (rare, but possible)
    results.sort((a, b) => a.startIdx - b.startIdx);

    const out: ThermalCircle[] = [];
    for (const cur of results) {
        const last = out[out.length - 1];
        if (!last) {
            out.push(cur);
            continue;
        }
        // if overlaps heavily, keep the better quality one or merge time range
        if (cur.startIdx <= last.endIdx) {
            if (cur.quality > last.quality) {
                // replace but keep broader span
                const merged = {
                    ...cur,
                    startIdx: Math.min(cur.startIdx, last.startIdx),
                    endIdx: Math.max(cur.endIdx, last.endIdx),
                    startSec: Math.min(cur.startSec, last.startSec),
                    endSec: Math.max(cur.endSec, last.endSec),
                };
                out[out.length - 1] = merged;
            } else {
                // extend last span slightly (keep its wind vector)
                last.endIdx = Math.max(last.endIdx, cur.endIdx);
                last.endSec = Math.max(last.endSec, cur.endSec);
            }
        } else {
            out.push(cur);
        }
    }

    return out;
}
