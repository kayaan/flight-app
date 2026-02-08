// src/features/flights/map/rdp.worker.ts
// Web Worker: RDP simplification for FixPoint[] (lat/lon) with epsilon in meters
/// <reference lib="webworker" />

import type { FixPoint } from "../igc";


type InMsg = {
    jobId: number;
    fixes: FixPoint[];
    epsilonMeters: number;
    minPointsNoRdp: number;
};

type OutMsg = {
    jobId: number;
    fixesLite: FixPoint[];
};

function metersPerDegLat() {
    return 111_320;
}
function metersPerDegLon(latDeg: number) {
    return 111_320 * Math.cos((latDeg * Math.PI) / 180);
}

function pointLineDistSqMeters(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number
) {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;

    const abLenSq = abx * abx + aby * aby;
    if (abLenSq <= 1e-12) return apx * apx + apy * apy;

    let t = (apx * abx + apy * aby) / abLenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;

    const cx = ax + t * abx;
    const cy = ay + t * aby;

    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy;
}

function rdpSimplifyFixes(
    fixes: FixPoint[],
    epsilonMeters: number,
    minPointsNoRdp: number
): FixPoint[] {
    const n = fixes.length;
    if (n < 3) return fixes;
    if (n < minPointsNoRdp) return fixes;
    if (!Number.isFinite(epsilonMeters) || epsilonMeters <= 0) return fixes;

    const lat0 = fixes[0].lat;
    const lon0 = fixes[0].lon;
    const kLat = metersPerDegLat();
    const kLon = metersPerDegLon(lat0);

    const x = new Array<number>(n);
    const y = new Array<number>(n);
    for (let i = 0; i < n; i++) {
        x[i] = (fixes[i].lon - lon0) * kLon;
        y[i] = (fixes[i].lat - lat0) * kLat;
    }

    const epsSq = epsilonMeters * epsilonMeters;

    const keep = new Uint8Array(n);
    keep[0] = 1;
    keep[n - 1] = 1;

    const stack: Array<[number, number]> = [[0, n - 1]];

    while (stack.length) {
        const [start, end] = stack.pop()!;
        if (end <= start + 1) continue;

        const ax = x[start], ay = y[start];
        const bx = x[end], by = y[end];

        let maxDistSq = -1;
        let idx = -1;

        for (let i = start + 1; i < end; i++) {
            const dSq = pointLineDistSqMeters(x[i], y[i], ax, ay, bx, by);
            if (dSq > maxDistSq) {
                maxDistSq = dSq;
                idx = i;
            }
        }

        if (maxDistSq > epsSq && idx !== -1) {
            keep[idx] = 1;
            stack.push([start, idx]);
            stack.push([idx, end]);
        }
    }

    const out: FixPoint[] = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(fixes[i]);

    if (out.length < 2) return [fixes[0], fixes[n - 1]];
    return out;
}

self.onmessage = (ev: MessageEvent<InMsg>) => {
    const { jobId, fixes, epsilonMeters, minPointsNoRdp } = ev.data;

    // Defensive
    if (!Array.isArray(fixes) || fixes.length < 2) {
        const msg: OutMsg = { jobId, fixesLite: fixes ?? [] };
        (self as DedicatedWorkerGlobalScope).postMessage(msg);
        return;
    }

    const fixesLite = rdpSimplifyFixes(fixes, epsilonMeters, minPointsNoRdp);

    const msg: OutMsg = { jobId, fixesLite };
    (self as DedicatedWorkerGlobalScope).postMessage(msg);
};
