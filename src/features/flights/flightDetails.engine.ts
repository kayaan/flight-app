// src/features/flights/flightDetails.engine.ts
// Pure helpers & engines for FlightDetailsRoute (no React, no stores, no DOM)

import type { SeriesPoint } from "./igc";

// ------------------------------
// TYPES
// ------------------------------

export interface AxisPointerLabelParams {
    value: number | string | Date;
    axisDimension: "x" | "y" | "z" | string;
    axisIndex: number;
    seriesData: Array<{
        seriesName?: string;
        value: any;
        dataIndex?: number;
        axisValue?: string | number;
        axisValueLabel?: string;
        [key: string]: any;
    }>;
    [key: string]: any;
}

export type SegmentStats = {
    hasSegment: boolean;

    durSec: number;

    altStart: number | null;
    altEnd: number | null;
    dAlt: number | null;
    altMin: number | null;
    altMax: number | null;

    vAvg: number | null;
    vMax: number | null;
    vMin: number | null;

    speedAvgKmh: number | null;
    speedMaxKmh: number | null;

    pctClimb: number | null;
    pctSink: number | null;
    pctGlide: number | null;

    longestClimbDurSec: number | null;
    longestClimbDAlt: number | null;
};

export type ChartKind = "alt" | "vario" | "speed";

// ------------------------------
// BASIC UTILS
// ------------------------------

export function clamp(n: number, min: number, max: number) {
    return Math.min(max, Math.max(min, n));
}

export function fmtTime(sec: number) {
    const s = Math.max(0, Math.floor(sec));
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (hh > 0) return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
    return `${mm}:${String(ss).padStart(2, "0")}`;
}

export function fmtSigned(n: number, digits = 0) {
    const s = n >= 0 ? "+" : "";
    return `${s}${n.toFixed(digits)}`;
}

export function colorForClimbIndex(i: number) {
    const colors = ["#ff006e", "#fb5607", "#ffbe0b", "#8338ec", "#3a86ff", "#06d6a0", "#ef476f", "#118ab2"];
    return colors[i % colors.length];
}

export function extractTSec(params: any): number | null {
    const v = params?.value ?? params?.data?.value ?? params?.data;

    if (Array.isArray(v)) {
        const x = v[0];
        return typeof x === "number" && Number.isFinite(x) ? x : null;
    }

    if (typeof v === "number" && Number.isFinite(v)) return v;
    return null;
}

export function lowerBoundSeries(points: SeriesPoint[], tSec: number) {
    let lo = 0;
    let hi = points.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (points[mid].tSec < tSec) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

export function upperBoundSeries(points: SeriesPoint[], tSec: number) {
    let lo = 0;
    let hi = points.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (points[mid].tSec <= tSec) lo = mid + 1;
        else hi = mid;
    }
    return Math.max(0, lo - 1);
}

// ------------------------------
// CHART HELPERS / CONSTS
// ------------------------------

export const axisPointerLabelFormatter = (params: AxisPointerLabelParams) => {
    const v = params.value as any;

    if (params.axisDimension === "x") {
        const t = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(t)) return "";
        return `${Math.round(t)} s`;
    }

    if (params.axisDimension === "y") {
        const h = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(h)) return "";
        return `${Math.round(h)} m`;
    }

    return "";
};

export function buildWindowMarkLine(startSec: number, endSec: number, totalSec: number) {
    const eps = 0.5;
    const isFull = startSec <= eps && endSec >= totalSec - eps;
    if (isFull || totalSec <= 0) return undefined;

    return {
        symbol: "none",
        label: { show: false },
        lineStyle: {
            color: "rgba(18, 230, 106, 0.9)",
            width: 2,
            type: "dashed",
            dashOffset: 0,
        },
        data: [{ xAxis: startSec }, { xAxis: endSec }],
    };
}

export function buildActiveRangeMarkLine(range: { startSec: number; endSec: number } | null) {
    if (!range) return [];
    return [
        {
            id: "__activeClimbRange",
            type: "line",
            data: [],
            silent: true,
            markLine: {
                symbol: "none",
                lineStyle: {
                    color: "#ffd400",
                    width: 3,
                    opacity: 0.9,
                },
                data: [{ xAxis: range.startSec }, { xAxis: range.endSec }],
            },
        },
    ];
}

export function buildClimbLinesSeries(enabled: boolean, climbMarkLineData: any[]) {
    return [
        {
            id: "__climbLines",
            name: "__climbLines",
            type: "line",
            data: [],
            silent: true,
            z: 9,
            markLine: {
                symbol: "none",
                label: { show: false },
                data: enabled && climbMarkLineData?.length ? climbMarkLineData : [],
            },
        },
    ];
}

export const ALT_AXIS_POINTER = {
    type: "cross",
    lineStyle: {
        color: "rgba(255, 77, 79, 0.9)",
        width: 1.5,
        type: "dashed",
        dashOffset: 0,
    },
    label: {
        show: true,
        formatter: axisPointerLabelFormatter,
    },
} as const;

export const ALT_GRID = { left: 56, right: 16, top: 24, bottom: 40 } as const;

export const ALT_DATAZOOM = [
    { id: "dz_inside_alt", type: "inside", xAxisIndex: 0, moveOnMouseMove: true },
    { id: "dz_slider_alt", type: "slider", xAxisIndex: 0, height: 20, bottom: 8 },
] as const;

export const VARIO_DATAZOOM = [{ id: "dz_inside_vario", type: "inside", xAxisIndex: 0, moveOnMouseMove: true }] as const;

export const SPEED_DATAZOOM = [{ id: "dz_inside_speed", type: "inside", xAxisIndex: 0, moveOnMouseMove: true }] as const;

// ------------------------------
// SERIES CALCULATIONS
// ------------------------------

export function calculateVarioFromSeries(points: SeriesPoint[], windowSec: number): [number, number][] {
    const n = points.length;
    if (!n) return [];
    const w = Math.max(0.25, windowSec);

    function idxAtOrBefore(target: number, hi: number) {
        let lo = 0;
        let h = hi;
        while (lo < h) {
            const mid = (lo + h + 1) >> 1;
            if (points[mid].tSec <= target) lo = mid;
            else h = mid - 1;
        }
        return lo;
    }

    const res: [number, number][] = new Array(n);

    for (let i = 0; i < n; i++) {
        const t = points[i].tSec;

        if (t < w) {
            res[i] = [t, 0];
            continue;
        }

        const target = t - w;
        const j = idxAtOrBefore(target, i);
        const a = points[j];
        const b = points[i];

        const dt = b.tSec - a.tSec;
        let v = 0;

        if (dt > 0.0001) v = (b.altitudeM - a.altitudeM) / dt;

        v = clamp(v, -25, 25);
        res[i] = [t, v];
    }

    return res;
}

export function calculateSmoothedSpeedFromSeries(points: SeriesPoint[], windowSec: number): [number, number][] {
    const n = points.length;
    if (!n) return [];
    const w = Math.max(0.25, windowSec);

    const t: number[] = new Array(n);
    const sp: number[] = new Array(n);

    for (let i = 0; i < n; i++) {
        t[i] = points[i].tSec;
        const v = points[i].gSpeedKmh;
        sp[i] = typeof v === "number" && Number.isFinite(v) ? v : NaN;
    }

    const A: number[] = new Array(n).fill(0);
    let acc = 0;
    for (let i = 0; i < n - 1; i++) {
        const dt = t[i + 1] - t[i];
        const v = sp[i];
        const add = dt > 0 && Number.isFinite(v) ? v * dt : 0;
        acc += add;
        A[i + 1] = acc;
    }

    function clamp01(x: number) {
        return x < 0 ? 0 : x > 1 ? 1 : x;
    }

    function areaAt(x: number): number {
        if (x <= t[0]) return 0;
        if (x >= t[n - 1]) return A[n - 1];

        let lo = 0;
        let hi = n - 2;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (t[mid + 1] <= x) lo = mid + 1;
            else hi = mid;
        }
        const i = lo;

        const base = A[i];
        const dt = t[i + 1] - t[i];
        if (dt <= 0) return base;

        const v = sp[i];
        if (!Number.isFinite(v)) return base;

        const frac = clamp01((x - t[i]) / dt);
        return base + v * (dt * frac);
    }

    const out: [number, number][] = new Array(n);

    for (let i = 0; i < n; i++) {
        const ti = t[i];

        if (ti < w) {
            const raw = sp[i];
            out[i] = [ti, Number.isFinite(raw) ? raw : 0];
            continue;
        }

        const a = ti - w;
        const b = ti;

        const area = areaAt(b) - areaAt(a);
        const avg = area / (b - a);

        out[i] = [ti, Number.isFinite(avg) ? avg : 0];
    }

    return out;
}

// ------------------------------
// SEGMENT / STATS ENGINE
// ------------------------------

export function computeSegmentStats(
    series: SeriesPoint[],
    varioSeries: [number, number][],
    startSec: number,
    endSec: number
): SegmentStats {
    if (!series.length || !varioSeries.length) {
        return {
            hasSegment: false,
            durSec: 0,
            altStart: null,
            altEnd: null,
            dAlt: null,
            altMin: null,
            altMax: null,
            vAvg: null,
            vMax: null,
            vMin: null,
            speedAvgKmh: null,
            speedMaxKmh: null,
            pctClimb: null,
            pctSink: null,
            pctGlide: null,
            longestClimbDurSec: null,
            longestClimbDAlt: null,
        };
    }

    const maxT = series[series.length - 1].tSec;

    let s = Math.max(0, Math.min(startSec, endSec));
    let e = Math.max(0, Math.max(startSec, endSec));
    if (Math.abs(e - s) < 0.0001) {
        s = 0;
        e = maxT;
    }

    s = clamp(s, 0, maxT);
    e = clamp(e, 0, maxT);
    const durSec = Math.max(0, e - s);

    if (durSec <= 0) {
        return {
            hasSegment: false,
            durSec,
            altStart: null,
            altEnd: null,
            dAlt: null,
            altMin: null,
            altMax: null,
            vAvg: null,
            vMax: null,
            vMin: null,
            speedAvgKmh: null,
            speedMaxKmh: null,
            pctClimb: null,
            pctSink: null,
            pctGlide: null,
            longestClimbDurSec: null,
            longestClimbDAlt: null,
        };
    }

    const i0 = clamp(lowerBoundSeries(series, s), 0, series.length - 1);
    const i1 = clamp(upperBoundSeries(series, e), 0, series.length - 1);

    const altStart = series[i0].altitudeM;
    const altEnd = series[i1].altitudeM;

    let altMin = Number.POSITIVE_INFINITY;
    let altMax = Number.NEGATIVE_INFINITY;

    let vSum = 0;
    let vCount = 0;
    let vMax = Number.NEGATIVE_INFINITY;
    let vMin = Number.POSITIVE_INFINITY;

    for (let i = i0; i <= i1; i++) {
        const t = varioSeries[i][0];
        if (t < s || t > e) continue;

        const v = varioSeries[i][1];
        vSum += v;
        vCount += 1;
        vMax = Math.max(vMax, v);
        vMin = Math.min(vMin, v);
    }

    const vAvg = vCount > 0 ? vSum / vCount : null;
    const vMaxOut = Number.isFinite(vMax) ? vMax : null;
    const vMinOut = Number.isFinite(vMin) ? vMin : null;

    const CLIMB_TH = 0.5;
    const SINK_TH = -0.7;
    let climbTime = 0;
    let sinkTime = 0;
    let glideTime = 0;

    for (let i = i0; i < i1; i++) {
        const a = series[i];
        const b = series[i + 1];

        const segStart = Math.max(a.tSec, s);
        const segEnd = Math.min(b.tSec, e);
        const dt = segEnd - segStart;
        if (dt <= 0) continue;

        const v = varioSeries[i][1];
        if (v > CLIMB_TH) climbTime += dt;
        else if (v < SINK_TH) sinkTime += dt;
        else glideTime += dt;
    }

    const totalPhase = climbTime + sinkTime + glideTime;
    const pctClimb = totalPhase > 0 ? (climbTime / totalPhase) * 100 : null;
    const pctSink = totalPhase > 0 ? (sinkTime / totalPhase) * 100 : null;
    const pctGlide = totalPhase > 0 ? (glideTime / totalPhase) * 100 : null;

    for (let i = i0; i <= i1; i++) {
        altMin = Math.min(altMin, series[i].altitudeM);
        altMax = Math.max(altMax, series[i].altitudeM);
    }

    let speedSum = 0;
    let speedDtSum = 0;
    let speedMax = Number.NEGATIVE_INFINITY;

    for (let i = i0; i < i1; i++) {
        const a = series[i];
        const b = series[i + 1];

        const segStart = Math.max(a.tSec, s);
        const segEnd = Math.min(b.tSec, e);
        const dt = segEnd - segStart;
        if (dt <= 0) continue;

        const sp = typeof a.gSpeedKmh === "number" && Number.isFinite(a.gSpeedKmh) ? a.gSpeedKmh : NaN;
        if (Number.isFinite(sp)) {
            speedSum += sp * dt;
            speedDtSum += dt;
            speedMax = Math.max(speedMax, sp);
        }
    }

    const speedAvg = speedDtSum > 0 ? speedSum / speedDtSum : null;

    let bestClimbT = 0;
    let bestClimbDAlt = 0;
    let curT = 0;
    let curStartAlt: number | null = null;

    for (let i = i0; i < i1; i++) {
        const a = series[i];
        const b = series[i + 1];

        const segStart = Math.max(a.tSec, s);
        const segEnd = Math.min(b.tSec, e);
        const dt = segEnd - segStart;
        if (dt <= 0) continue;

        const v = varioSeries[i][1];
        if (v > CLIMB_TH) {
            if (curStartAlt == null) curStartAlt = a.altitudeM;
            curT += dt;
        } else {
            if (curT > bestClimbT) {
                bestClimbT = curT;
                bestClimbDAlt = curStartAlt == null ? 0 : a.altitudeM - curStartAlt;
            }
            curT = 0;
            curStartAlt = null;
        }
    }
    if (curT > bestClimbT) {
        bestClimbT = curT;
        bestClimbDAlt = curStartAlt == null ? 0 : altEnd - curStartAlt;
    }

    return {
        hasSegment: true,
        durSec,

        altStart,
        altEnd,
        dAlt: altEnd - altStart,
        altMin: Number.isFinite(altMin) ? altMin : null,
        altMax: Number.isFinite(altMax) ? altMax : null,

        vAvg,
        vMax: vMaxOut,
        vMin: vMinOut,

        speedAvgKmh: speedAvg,
        speedMaxKmh: Number.isFinite(speedMax) ? speedMax : null,

        pctClimb,
        pctSink,
        pctGlide,

        longestClimbDurSec: bestClimbT,
        longestClimbDAlt: bestClimbDAlt,
    };
}