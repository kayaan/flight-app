// flights.$id.tsx
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Box,
  Stack,
  Text,
  Alert,
  Button,
  Group,
  Checkbox,
  SimpleGrid,
  Paper,
  NumberInput,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import EChartsReact from "echarts-for-react";
import * as echarts from "echarts";

import type { FlightRecordDetails } from "../features/flights/flights.types";
import { buildFlightSeries, calculationWindow, parseIgcFixes } from "../features/flights/igc/igc.series";
import { useAuthStore } from "../features/auth/store/auth.store";
import { flightApi } from "../features/flights/flights.api";
import type { SeriesPoint } from "../features/flights/igc";

import { FlightMap, type FixPoint, type BaseMap } from "../features/flights/map/FlightMapBase";
import { useFlightHoverStore } from "../features/flights/store/flightHover.store";
import { useTimeWindowStore } from "../features/flights/store/timeWindow.store";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface AxisPointerLabelParams {
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

const axisPointerLabelFormatter = (params: AxisPointerLabelParams) => {
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

function buildWindowMarkLine(startSec: number, endSec: number, totalSec: number) {
  const eps = 0.5;
  const isFull = startSec <= eps && endSec >= totalSec - eps;
  if (isFull || totalSec <= 0) return undefined;

  return {
    symbol: "none",
    label: { show: false },
    lineStyle: {
      color: "rgba(18, 230, 106, 0.9)", // grün
      width: 2,
      type: "dashed",
      dashOffset: 0,
    },
    data: [{ xAxis: startSec }, { xAxis: endSec }],
  };
}

const ALT_AXIS_POINTER = {
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

const ALT_GRID = { left: 56, right: 16, top: 24, bottom: 40 } as const;

const ALT_DATAZOOM = [
  { type: "inside", xAxisIndex: 0 },
  { type: "slider", xAxisIndex: 0, height: 20, bottom: 8 },
] as const;

const INSIDE_ZOOM = [{ type: "inside", xAxisIndex: 0 }] as const;

export const Route = createFileRoute("/flights/$id")({
  component: FlightDetailsRoute,
});

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function fmtTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

/**
 * Vario "wie echtes Vario": Steigrate über ein zeitbasiertes Fenster (Sekunden),
 * als trailing-window: v(t) = (alt(t) - alt(t - win)) / (t - (t - win)).
 *
 * Liefert [tSec, vMs] für jeden SeriesPoint.
 */
function calculateVarioFromSeries(points: SeriesPoint[], windowSec: number): [number, number][] {
  const n = points.length;
  if (!n) return [];
  const w = Math.max(0.25, windowSec);

  // binary search: largest index j with points[j].tSec <= target (j <= hi)
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

    // ✅ Warm-up: bevor das volle Fenster verfügbar ist, kein Peak erzeugen
    if (t < w) {
      res[i] = [t, 0];
      continue;
    }

    const target = t - w;
    const j = idxAtOrBefore(target, i); // j <= i
    const a = points[j];
    const b = points[i];

    const dt = b.tSec - a.tSec;
    let v = 0;

    // dt sollte hier i.d.R. ~w sein; wenn nicht, trotzdem sicher bleiben
    if (dt > 0.0001) v = (b.altitudeM - a.altitudeM) / dt;

    // optional: glitch clamp (sehr großzügig)
    v = clamp(v, -25, 25);

    // NICHT runden für "Max", nur Anzeige/Tooltip runden
    res[i] = [t, v];
  }

  return res;
}


function extractTSec(params: any): number | null {
  const v = params?.value ?? params?.data?.value ?? params?.data;

  if (Array.isArray(v)) {
    const x = v[0];
    return typeof x === "number" && Number.isFinite(x) ? x : null;
  }

  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function lowerBoundSeries(points: SeriesPoint[], tSec: number) {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].tSec < tSec) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function upperBoundSeries(points: SeriesPoint[], tSec: number) {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].tSec <= tSec) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

type SegmentStats = {
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

function vAt(varioSeries: [number, number][], t: number): number {
  const n = varioSeries.length;
  if (!n) return 0;

  // clamp to bounds
  if (t <= varioSeries[0][0]) return varioSeries[0][1];
  if (t >= varioSeries[n - 1][0]) return varioSeries[n - 1][1];

  // binary search: find right index r where t <= t_r
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (varioSeries[mid][0] < t) lo = mid + 1;
    else hi = mid;
  }
  const r = lo;
  const l = r - 1;

  const t0 = varioSeries[l][0];
  const v0 = varioSeries[l][1];
  const t1 = varioSeries[r][0];
  const v1 = varioSeries[r][1];

  const dt = t1 - t0;
  if (dt <= 0) return v1;

  const a = (t - t0) / dt;
  return v0 + (v1 - v0) * a;
}

/**
 * Wichtig: vAvg/vMax/vMin werden aus DERSELBEN Vario-Reihe berechnet,
 * die auch im Chart gezeichnet wird (varioSeries).
 *
 * varioSeries muss 1:1 zu series passen (gleiche Indizes), als [tSec, vMs].
 */
function computeSegmentStats(
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

  // ✅ wenn noch kein Fenster gesetzt (start==end), nimm Full Flight
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

  // --- Vario stats: EXAKT aus varioSeries im Zeitfenster ---
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

  // Phase-Analyse (ebenfalls aus derselben Vario-Kurve, simpel)
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

    const v = varioSeries[i][1]; // “zugehörig” zum Zeitpunkt a.tSec, aber für Phase reicht’s stabil
    if (v > CLIMB_TH) climbTime += dt;
    else if (v < SINK_TH) sinkTime += dt;
    else glideTime += dt;
  }

  const totalPhase = climbTime + sinkTime + glideTime;
  const pctClimb = totalPhase > 0 ? (climbTime / totalPhase) * 100 : null;
  const pctSink = totalPhase > 0 ? (sinkTime / totalPhase) * 100 : null;
  const pctGlide = totalPhase > 0 ? (glideTime / totalPhase) * 100 : null;

  // Alt min/max über Punkte
  for (let i = i0; i <= i1; i++) {
    altMin = Math.min(altMin, series[i].altitudeM);
    altMax = Math.max(altMax, series[i].altitudeM);
  }

  // Speed stats (gewichtet)
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

  // Longest climb block (einfach, stabil)
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
        bestClimbDAlt = curStartAlt == null ? 0 : (a.altitudeM - curStartAlt);
      }
      curT = 0;
      curStartAlt = null;
    }
  }
  if (curT > bestClimbT) {
    bestClimbT = curT;
    bestClimbDAlt = curStartAlt == null ? 0 : (altEnd - curStartAlt);
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


function fmtSigned(n: number, digits = 0) {
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(digits)}`;
}

export default function FlightDetailsRoute() {
  const token = useAuthStore((s) => s.token);
  const { id } = Route.useParams();

  const FOLLOW_KEY = "flyapp.flightDetails.followMarker";
  const STATS_KEY = "flyapp.flightDetails.showStats";
  const VARIO_WIN_KEY = "flyapp.flightDetails.varioWindowSec";

  const [followEnabled, setFollowEnabled] = React.useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(FOLLOW_KEY);
      if (raw == null) return true;
      return raw === "1";
    } catch {
      return true;
    }
  });

  React.useEffect(() => {
    try {
      localStorage.setItem(FOLLOW_KEY, followEnabled ? "1" : "0");
    } catch {
      // ignore
    }
  }, [followEnabled]);

  const [showStats, setShowStats] = React.useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      if (raw == null) return true; // default ON
      return raw === "1";
    } catch {
      return true;
    }
  });

  React.useEffect(() => {
    try {
      localStorage.setItem(STATS_KEY, showStats ? "1" : "0");
    } catch {
      // ignore
    }
  }, [showStats]);

  // ✅ Vario-Fenster (Default 4s, änderbar + persisted)
  const [varioWindowSec, setVarioWindowSec] = React.useState<number>(() => {
    try {
      const raw = localStorage.getItem(VARIO_WIN_KEY);
      const n = raw == null ? NaN : Number(raw);
      if (Number.isFinite(n) && n > 0) return clamp(n, 1, 30);
      return 4;
    } catch {
      return 4;
    }
  });

  React.useEffect(() => {
    try {
      localStorage.setItem(VARIO_WIN_KEY, String(varioWindowSec));
    } catch {
      // ignore
    }
  }, [varioWindowSec]);

  const setHoverTSecThrottled = useFlightHoverStore((s) => s.setHoverTSecThrottled);
  const clearNow = useFlightHoverStore((s) => s.clearNow);

  const chartEvents = React.useMemo(() => {
    return {
      mousemove: (params: any) => {
        const t = extractTSec(params);
        if (t != null) setHoverTSecThrottled(t);
      },
      updateAxisPointer: (e: any) => {
        const ax = e?.axesInfo?.[0];
        const t = ax?.value;
        if (typeof t === "number" && Number.isFinite(t)) setHoverTSecThrottled(t);
      },
      globalout: () => {
        clearNow();
      },
    } as const;
  }, [setHoverTSecThrottled, clearNow]);

  const [flight, setFlight] = React.useState<FlightRecordDetails | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [windowSec] = React.useState(calculationWindow);

  const [baseMap, setBaseMap] = React.useState<BaseMap>("topo");

  const [syncEnabled, setSyncEnabled] = React.useState(true);
  const chartGroupId = React.useMemo(() => `flight-${id}-charts`, [id]);

  const altInstRef = React.useRef<any>(null);
  const varioInstRef = React.useRef<any>(null);
  const speedInstRef = React.useRef<any>(null);
  const [chartsReadyTick, setChartsReadyTick] = React.useState(0);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const draggingRef = React.useRef(false);
  const [splitPct, setSplitPct] = React.useState<number>(60);

  const stopDragging = React.useCallback(() => {
    draggingRef.current = false;
  }, []);

  const onDividerPointerDown = React.useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }, []);

  const onDividerPointerMove = React.useCallback((clientX: number) => {
    if (!draggingRef.current) return;

    const el = containerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = (x / rect.width) * 100;

    setSplitPct(clamp(pct, 40, 75));
  }, []);

  React.useEffect(() => {
    function onMove(ev: PointerEvent) {
      onDividerPointerMove(ev.clientX);
    }
    function onUp() {
      stopDragging();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [onDividerPointerMove, stopDragging]);

  React.useEffect(() => {
    let cancelled = false;

    async function run() {
      setBusy(true);
      setError(null);
      setFlight(null);

      try {
        if (!token) throw new Error("Not authenticated");

        const numericId = Number(id);
        if (!Number.isFinite(numericId)) throw new Error("Invalid flight id");

        const f = await flightApi.getFlightById(numericId, token);
        if (!cancelled) setFlight(f);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load flight");
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [id, token]);

  const fixesFull = React.useMemo(() => {
    if (!flight?.igcContent || !flight.flightDate) return null;
    return parseIgcFixes(flight.igcContent, flight.flightDate);
  }, [flight]);

  const computed = React.useMemo(() => {
    if (!fixesFull) return null;

    const { series } = buildFlightSeries(fixesFull, windowSec);

    const t0 = fixesFull[0]?.tSec ?? 0;
    const fixes: FixPoint[] = fixesFull.map((f) => ({
      tSec: f.tSec - t0,
      lat: f.lat,
      lon: f.lon,
      altitudeM: f.altitudeM,
    }));

    return { series, fixes };
  }, [fixesFull, windowSec]);

  const chartData = React.useMemo(() => {
    if (!computed) return null;

    const alt = computed.series.map((p) => [p.tSec, p.altitudeM] as [number, number]);
    const hSpeed = computed.series.map((p) => [p.tSec, p.gSpeedKmh] as [number, number]);

    // ✅ NEU: vario = zeitbasiert (Default 4s), und wird auch für Stats verwendet
    const vSpeed = calculateVarioFromSeries(computed.series, varioWindowSec);

    const maxT = computed.series.length ? computed.series[computed.series.length - 1].tSec : 0;

    const altValues = alt.map((p) => p[1]);
    const altMin = Math.min(...altValues);
    const altMax = Math.max(...altValues);

    const vVals = vSpeed.map((p) => p[1]);
    const vAbsMax = Math.max(1, ...vVals.map((v) => Math.abs(v)));
    const vMax = Math.ceil(vAbsMax * 1.1 * 2) / 2;
    const vMin = -vMax;

    return { alt, hSpeed, vSpeed, maxT, altMin, altMax, vMin, vMax };
  }, [computed, varioWindowSec]);

  const baseOption = React.useMemo(() => {
    return {
      animation: false,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
      },
      axisPointer: {
        snap: true,
        link: [{ xAxisIndex: "all" }],
      },
    };
  }, []);

  const altitudeTooltipFormatter = (params: any[]) => {
    const y = params?.[0]?.value?.[1];
    const h = typeof y === "number" ? y : Number(y);
    if (!Number.isFinite(h)) return "";
    return `<strong>${Math.round(h)} m</strong>`;
  };

  // Time window from store (throttled updates)
  const win = useTimeWindowStore((s) => s.window);
  const startSec = win?.startSec ?? 0;
  const endSec = win?.endSec ?? 0;
  const totalSec = win?.totalSec ?? (chartData?.maxT ?? 0);

  const windowMarkLine = React.useMemo(
    () => buildWindowMarkLine(startSec, endSec, totalSec),
    [startSec, endSec, totalSec]
  );

  const segmentStats = React.useMemo(() => {
    if (!computed?.series || !chartData?.vSpeed) return null;
    return computeSegmentStats(computed.series, chartData.vSpeed, startSec, endSec);
  }, [computed?.series, chartData?.vSpeed, startSec, endSec]);

  const altOption = React.useMemo(() => {
    if (!chartData) return {};

    return {
      ...baseOption,
      tooltip: {
        trigger: "axis",
        axisPointer: ALT_AXIS_POINTER,
        formatter: altitudeTooltipFormatter,
      },
      grid: ALT_GRID,
      xAxis: {
        type: "value",
        min: 0,
        max: chartData.maxT,
        axisLabel: { formatter: (v: number) => fmtTime(v) },
      },
      yAxis: {
        type: "value",
        name: "m",
        min: chartData.altMin,
        max: chartData.altMax,
        scale: true,
      },
      dataZoom: ALT_DATAZOOM,
      series: [
        {
          id: "alt",
          name: "Altitude",
          type: "line",
          data: chartData.alt,
          showSymbol: false,
          lineStyle: { width: 2 },
        },
        {
          id: "__window",
          name: "__window",
          type: "line",
          data: [],
          silent: true,
          markLine: windowMarkLine,
        },
      ],
    };
  }, [chartData, baseOption, windowMarkLine]);

  const varioOption = React.useMemo(() => {
    if (!chartData) return {};
    return {
      ...baseOption,
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "cross",
          lineStyle: {
            color: "rgba(255, 77, 79, 0.9)",
            width: 1.5,
            type: "dashed",
            dashOffset: 0,
          },
          label: {
            show: true,
            formatter: (params: AxisPointerLabelParams) => {
              if (params.axisDimension === "x") {
                const time = params.value as number;
                return time.toFixed(0) + " s";
              }
              if (params.axisDimension === "y") {
                const vSpeed = params.value as number;
                return vSpeed.toFixed(1) + " m/s";
              }
              return "";
            },
          },
        },
        formatter: (params: any[]) => {
          const y = params?.[0]?.value?.[1];
          if (y == null) return "";
          return `<strong>${Number(y).toFixed(1)} m/s</strong>`;
        },
      },
      grid: { left: 56, right: 16, top: 24, bottom: 24 },
      xAxis: { type: "value", min: 0, max: chartData.maxT, axisLabel: { formatter: (v: number) => fmtTime(v) } },
      yAxis: { type: "value", name: "m/s", min: chartData.vMin, max: chartData.vMax, scale: true },
      dataZoom: INSIDE_ZOOM,
      series: [
        {
          id: "vario",
          name: `Vario (${varioWindowSec}s)`,
          type: "line",
          data: chartData.vSpeed,
          showSymbol: false,
          lineStyle: { width: 2 },
          smooth: 0.35,
          smoothMonotone: "x",
          markLine: { symbol: ["none", "none"], lineStyle: { type: "dashed", opacity: 0.6 }, data: [{ yAxis: 0 }] },
        },
        {
          id: "__window",
          name: "__window",
          type: "line",
          data: [],
          silent: true,
          markLine: windowMarkLine,
        },
      ],
    };
  }, [chartData, baseOption, windowMarkLine, varioWindowSec]);

  const speedOption = React.useMemo(() => {
    if (!chartData) return {};
    return {
      ...baseOption,
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "cross",
          lineStyle: {
            color: "rgba(255, 77, 79, 0.9)",
            width: 1.5,
            type: "dashed",
            dashOffset: 0,
          },
          label: {
            show: true,
            formatter: (params: AxisPointerLabelParams) => {
              if (params.axisDimension === "x") {
                const time = params.value as number;
                return time.toFixed(0) + " s";
              }
              if (params.axisDimension === "y") {
                const speed = params.value as number;
                return speed.toFixed(0) + " km/h";
              }
              return "";
            },
          },
        },
        formatter: (params: any[]) => {
          const y = params?.[0]?.value?.[1];
          if (y == null) return "";
          return `<strong>${Number(y).toFixed(1)} km/h</strong>`;
        },
      },
      grid: { left: 56, right: 16, top: 24, bottom: 24 },
      xAxis: { type: "value", min: 0, max: chartData.maxT, axisLabel: { formatter: (v: number) => fmtTime(v) } },
      yAxis: { type: "value", name: "km/h", scale: true },
      dataZoom: INSIDE_ZOOM,
      series: [
        {
          id: "speed",
          name: "Ground speed",
          type: "line",
          data: chartData.hSpeed,
          showSymbol: false,
          lineStyle: { width: 2 },
        },
        {
          id: "__window",
          name: "__window",
          type: "line",
          data: [],
          silent: true,
          markLine: windowMarkLine,
        },
      ],
    };
  }, [chartData, baseOption, windowMarkLine]);

  React.useEffect(() => {
    const a = altInstRef.current;
    const v = varioInstRef.current;
    const s = speedInstRef.current;

    echarts.disconnect(chartGroupId);

    if (!syncEnabled) return;
    if (!a || !v || !s) return;

    a.group = chartGroupId;
    v.group = chartGroupId;
    s.group = chartGroupId;

    echarts.connect(chartGroupId);

    return () => {
      echarts.disconnect(chartGroupId);
    };
  }, [chartGroupId, syncEnabled, chartsReadyTick]);

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      altInstRef.current?.resize?.();
      varioInstRef.current?.resize?.();
      speedInstRef.current?.resize?.();
    }, 40);

    return () => window.clearTimeout(t);
  }, [splitPct]);

  const StatsPanel = React.useMemo(() => {
    if (!showStats) return null;
    if (!segmentStats || !segmentStats.hasSegment) return null;

    const s = segmentStats;

    const dur = fmtTime(s.durSec);
    const altStart = s.altStart != null ? Math.round(s.altStart) : null;
    const altEnd = s.altEnd != null ? Math.round(s.altEnd) : null;
    const dAlt = s.dAlt != null ? s.dAlt : null;

    const altMin = s.altMin != null ? Math.round(s.altMin) : null;
    const altMax = s.altMax != null ? Math.round(s.altMax) : null;

    const vAvg = s.vAvg != null ? s.vAvg : null;
    const vMax = s.vMax != null ? s.vMax : null;
    const vMin = s.vMin != null ? s.vMin : null;

    const spAvg = s.speedAvgKmh != null ? s.speedAvgKmh : null;
    const spMax = s.speedMaxKmh != null ? s.speedMaxKmh : null;

    const pctClimb = s.pctClimb != null ? s.pctClimb : null;
    const pctSink = s.pctSink != null ? s.pctSink : null;
    const pctGlide = s.pctGlide != null ? s.pctGlide : null;

    const bestClimbT = s.longestClimbDurSec != null ? s.longestClimbDurSec : null;
    const bestClimbDAlt = s.longestClimbDAlt != null ? s.longestClimbDAlt : null;

    return (
      <Paper withBorder p="sm" radius="md">
        <Group justify="space-between" mb="xs">
          <Text fw={600} size="sm">
            Segment Stats
          </Text>
          <Text size="xs" c="dimmed">
            {fmtTime(Math.min(startSec, endSec))} → {fmtTime(Math.max(startSec, endSec))} / {fmtTime(totalSec)}
          </Text>
        </Group>

        <SimpleGrid cols={4} spacing="xs" verticalSpacing="xs">
          <Box>
            <Text size="xs" c="dimmed">Dauer</Text>
            <Text fw={600}>{dur}</Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">Δ Höhe</Text>
            <Text fw={600}>{dAlt == null ? "—" : `${fmtSigned(dAlt, 0)} m`}</Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">Alt (Start → Ende)</Text>
            <Text fw={600}>
              {altStart == null || altEnd == null ? "—" : `${altStart} → ${altEnd} m`}
            </Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">Alt (Min / Max)</Text>
            <Text fw={600}>
              {altMin == null || altMax == null ? "—" : `${altMin} / ${altMax} m`}
            </Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">Ø Vario ({varioWindowSec}s)</Text>
            <Text fw={600}>{vAvg == null ? "—" : `${vAvg.toFixed(2)} m/s`}</Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">Vario (Min / Max)</Text>
            <Text fw={600}>
              {vMin == null || vMax == null ? "—" : `${vMin.toFixed(2)} / ${vMax.toFixed(2)} m/s`}
            </Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">Ø Speed</Text>
            <Text fw={600}>{spAvg == null ? "—" : `${spAvg.toFixed(1)} km/h`}</Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">Speed (Max)</Text>
            <Text fw={600}>{spMax == null ? "—" : `${spMax.toFixed(1)} km/h`}</Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">Climb / Sink / Glide</Text>
            <Text fw={600}>
              {pctClimb == null || pctSink == null || pctGlide == null
                ? "—"
                : `${pctClimb.toFixed(0)}% / ${pctSink.toFixed(0)}% / ${pctGlide.toFixed(0)}%`}
            </Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">Längste Climb-Phase</Text>
            <Text fw={600}>
              {bestClimbT == null || bestClimbDAlt == null
                ? "—"
                : `${fmtTime(bestClimbT)} (${fmtSigned(bestClimbDAlt, 0)} m)`}
            </Text>
          </Box>
        </SimpleGrid>
      </Paper>
    );
  }, [showStats, segmentStats, startSec, endSec, totalSec, varioWindowSec]);

  return (
    <Box p="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Button variant="light" onClick={() => window.history.back()}>
            Back
          </Button>

          <Group gap="md" align="center">
            <Checkbox
              label="Topo"
              checked={baseMap === "topo"}
              onChange={(e) => setBaseMap(e.currentTarget.checked ? "topo" : "osm")}
            />
            <Checkbox label="Charts sync" checked={syncEnabled} onChange={(e) => setSyncEnabled(e.currentTarget.checked)} />
            <Checkbox label="Follow marker" checked={followEnabled} onChange={(e) => setFollowEnabled(e.currentTarget.checked)} />
            <Checkbox label="Show stats" checked={showStats} onChange={(e) => setShowStats(e.currentTarget.checked)} />

            {/* ✅ 4s default, änderbar */}
            <NumberInput
              label="Vario win (s)"
              value={varioWindowSec}
              onChange={(v) => {
                const n = typeof v === "number" ? v : Number(v);
                if (!Number.isFinite(n)) return;
                setVarioWindowSec(clamp(Math.round(n), 1, 30));
              }}
              min={1}
              max={30}
              step={1}
              w={140}
              size="xs"
              styles={{
                label: { marginBottom: 2 },
              }}
            />
          </Group>
        </Group>

        {busy && <Text c="dimmed">Loading...</Text>}

        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
            {error}
          </Alert>
        )}

        {!busy && !error && !flight && <Text c="dimmed">No flight found.</Text>}

        {flight && !computed && (
          <Text c="dimmed" size="sm">
            Missing igcContent or flightDate.
          </Text>
        )}

        {computed && chartData && (
          <Box
            ref={containerRef}
            style={{
              display: "flex",
              alignItems: "stretch",
              width: "100%",
              height: "calc(100vh - 180px)",
              minHeight: 520,
            }}
          >
            {/* LEFT: Charts */}
            <Box style={{ width: `${splitPct}%`, paddingRight: 12, minWidth: 320, overflow: "auto" }}>
              <Stack gap="xs">
                {StatsPanel}

                <Box>
                  <Text size="sm" fw={600} mb={4}>
                    Altitude
                  </Text>
                  <EChartsReact
                    onEvents={chartEvents}
                    echarts={echarts}
                    option={altOption}
                    style={{ height: 320, width: "100%" }}
                    notMerge
                    onChartReady={(inst) => {
                      altInstRef.current = inst;
                      inst.group = chartGroupId;
                      setChartsReadyTick((x) => x + 1);
                    }}
                  />
                </Box>

                <Box>
                  <Text size="sm" fw={600} mb={4}>
                    Vertical speed (Vario)
                  </Text>
                  <EChartsReact
                    onEvents={chartEvents}
                    echarts={echarts}
                    option={varioOption}
                    style={{ height: 220, width: "100%" }}
                    notMerge
                    onChartReady={(inst) => {
                      varioInstRef.current = inst;
                      inst.group = chartGroupId;
                      setChartsReadyTick((x) => x + 1);
                    }}
                  />
                </Box>

                <Box>
                  <Text size="sm" fw={600} mb={4}>
                    Horizontal speed
                  </Text>
                  <EChartsReact
                    onEvents={chartEvents}
                    echarts={echarts}
                    option={speedOption}
                    style={{ height: 220, width: "100%" }}
                    notMerge
                    onChartReady={(inst) => {
                      speedInstRef.current = inst;
                      inst.group = chartGroupId;
                      setChartsReadyTick((x) => x + 1);
                    }}
                  />
                </Box>
              </Stack>
            </Box>

            {/* MIDDLE: Splitter */}
            <Box
              onPointerDown={onDividerPointerDown}
              style={{
                width: 12,
                cursor: "col-resize",
                userSelect: "none",
                touchAction: "none",
                display: "flex",
                alignItems: "stretch",
                marginRight: 12,
              }}
            >
              <Box style={{ width: 1, margin: "0 auto", background: "var(--mantine-color-gray-3)" }} />
            </Box>

            {/* RIGHT: Map */}
            <Box style={{ width: `${100 - splitPct}%`, minWidth: 280, display: "flex", flexDirection: "column", minHeight: 0 }}>
              <Text size="sm" fw={600} mb={4}>
                Map
              </Text>
              <Box style={{ flex: 1, minHeight: 0 }}>
                <FlightMap fixes={computed.fixes} baseMap={baseMap} watchKey={`${id}-${baseMap}`} followEnabled={followEnabled} />
              </Box>
            </Box>
          </Box>
        )}
      </Stack>
    </Box>
  );
}
