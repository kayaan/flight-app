// src/features/flights/FlightDetailsRoute.tsx
import * as React from "react";
import { useParams } from "@tanstack/react-router";
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

import type { FlightRecordDetails } from "./flights.types";
import { buildFlightSeries, calculationWindow, parseIgcFixes } from "./igc/igc.series";
import { useAuthStore } from "../auth/store/auth.store";
import { flightApi } from "./flights.api";
import type { FixPoint, SeriesPoint } from "./igc";

import { FlightMap, type BaseMap } from "./map/FlightMapBase";
import { useFlightHoverStore } from "./store/flightHover.store";
import { useTimeWindowStore } from "./store/timeWindow.store";
import { detectClimbPhases } from "./analysis/turns/detectClimbPhases";

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

const ZOOM_SYNC_KEY = "flyapp.flightDetails.zoomSync";
const AUTO_FIT_KEY = "flyapp.flightDetails.autoFitSelection";

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
      color: "rgba(18, 230, 106, 0.9)",
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
  { id: "dz_inside_alt", type: "inside", xAxisIndex: 0, moveOnMouseMove: true },
  { id: "dz_slider_alt", type: "slider", xAxisIndex: 0, height: 20, bottom: 8 },
] as const;

const VARIO_DATAZOOM = [
  { id: "dz_inside_vario", type: "inside", xAxisIndex: 0, moveOnMouseMove: true },
] as const;
const SPEED_DATAZOOM = [
  { id: "dz_inside_speed", type: "inside", xAxisIndex: 0, moveOnMouseMove: true },
] as const;

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

function calculateVarioFromSeries(points: SeriesPoint[], windowSec: number): [number, number][] {
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

function calculateSmoothedSpeedFromSeries(points: SeriesPoint[], windowSec: number): [number, number][] {
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

function fmtSigned(n: number, digits = 0) {
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(digits)}`;
}

function colorForClimbIndex(i: number) {
  const colors = [
    "#ff006e",
    "#fb5607",
    "#ffbe0b",
    "#8338ec",
    "#3a86ff",
    "#06d6a0",
    "#ef476f",
    "#118ab2",
  ];
  return colors[i % colors.length];
}

type ChartKind = "alt" | "vario" | "speed";

export function FlightDetailsRoute() {
  const token = useAuthStore((s) => s.token);
  const { id } = useParams({ from: "/flights/$id" });

  const FOLLOW_KEY = "flyapp.flightDetails.followMarker";
  const STATS_KEY = "flyapp.flightDetails.showStats";
  const VARIO_WIN_KEY = "flyapp.flightDetails.varioWindowSec";

  const SHOW_ALT_KEY = "flyapp.flightDetails.showChart.alt";
  const SHOW_VARIO_KEY = "flyapp.flightDetails.showChart.vario";
  const SHOW_SPEED_KEY = "flyapp.flightDetails.showChart.speed";

  const [followEnabled, setFollowEnabled] = React.useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(FOLLOW_KEY);
      if (raw == null) return true;
      return raw === "1";
    } catch {
      return true;
    }
  });

  const [zoomSyncEnabled, setZoomSyncEnabled] = React.useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(ZOOM_SYNC_KEY);
      if (raw == null) return true; // default: an
      return raw === "1";
    } catch {
      return true;
    }
  });



  React.useEffect(() => {
    try {
      localStorage.setItem(ZOOM_SYNC_KEY, zoomSyncEnabled ? "1" : "0");
    } catch { }
  }, [zoomSyncEnabled]);

  React.useEffect(() => {
    try {
      localStorage.setItem(FOLLOW_KEY, followEnabled ? "1" : "0");
    } catch { }
  }, [followEnabled]);

  const [showStats, setShowStats] = React.useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(STATS_KEY);
      if (raw == null) return true;
      return raw === "1";
    } catch {
      return true;
    }
  });

  React.useEffect(() => {
    try {
      localStorage.setItem(STATS_KEY, showStats ? "1" : "0");
    } catch { }
  }, [showStats]);

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
    } catch { }
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

  const [chartReady, setChartReady] = React.useState({
    alt: false,
    vario: false,
    speed: false,
  });

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
        const numericId = Number(id);
        if (!Number.isFinite(numericId)) throw new Error("Invalid flight id");

        const f = await flightApi.getFlightById(numericId, token ?? "");
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
    const fixesFullRel: FixPoint[] = fixesFull.map((f) => ({
      tSec: f.tSec - t0,
      lat: f.lat,
      iso: f.iso,
      lon: f.lon,
      altitudeM: f.altitudeM,
    }));

    return { series, fixesFull: fixesFullRel };
  }, [fixesFull, windowSec]);

  const climbs = React.useMemo(() => {
    const f = computed?.fixesFull ?? null;
    if (!f) return [];
    return detectClimbPhases(f, {
      startGainM: 15,
      minGainM: 150,
      dropPct: 0.25,
      minDropAbsM: 40,
      minLenPts: 25,
    });
  }, [computed?.fixesFull]);

  const climbMarkLineData = React.useMemo(() => {
    const f = computed?.fixesFull;
    if (!f || !climbs.length) return [];

    const data: any[] = [];

    for (let i = 0; i < climbs.length; i++) {
      const c = climbs[i];

      const startSec = f[c.startIdx]?.tSec;
      const endSec = f[c.endIdx]?.tSec;
      if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) continue;

      const color = colorForClimbIndex(i);

      // Start line
      data.push({
        xAxis: startSec,
        lineStyle: { color, width: 2, opacity: 0.9 },
        label: { show: false },
      });

      // End line
      data.push({
        xAxis: endSec,
        lineStyle: { color, width: 2, opacity: 0.9 },
        label: { show: false },
      });
    }

    return data;
  }, [computed?.fixesFull, climbs]);

  const [fixesLite, setFixesLite] = React.useState<FixPoint[] | null>(null);
  const rdpJobRef = React.useRef(0);

  React.useEffect(() => {
    const full = computed?.fixesFull;
    if (!full || full.length < 2) {
      setFixesLite(null);
      return;
    }

    setFixesLite(full);

    const RDP_MIN_POINTS = 1000;
    const RDP_EPS_METERS = 20;

    if (full.length < RDP_MIN_POINTS) return;

    const jobId = ++rdpJobRef.current;

    const worker = new Worker(new URL("./map/rdp.worker.ts", import.meta.url), { type: "module" });

    worker.onmessage = (ev: MessageEvent<{ jobId: number; fixesLite: FixPoint[] }>) => {
      if (ev.data?.jobId !== jobId) return;
      setFixesLite(ev.data.fixesLite);
      worker.terminate();
    };

    worker.onerror = () => {
      worker.terminate();
    };

    worker.postMessage({
      jobId,
      fixes: full,
      epsilonMeters: RDP_EPS_METERS,
      minPointsNoRdp: RDP_MIN_POINTS,
    });

    return () => {
      worker.terminate();
    };
  }, [computed?.fixesFull]);

  const computedWithLite = React.useMemo(() => {
    if (!computed) return null;
    return {
      ...computed,
      fixesLite: fixesLite ?? computed.fixesFull,
    };
  }, [computed, fixesLite]);

  const chartData = React.useMemo(() => {
    if (!computed) return null;

    const alt = computed.series.map((p) => [p.tSec, p.altitudeM] as [number, number]);
    const hSpeed = calculateSmoothedSpeedFromSeries(computed.series, 4);
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

  const win = useTimeWindowStore((s) => s.window);
  const setWindow = useTimeWindowStore((s) => s.setWindow);
  const setDragging = useTimeWindowStore((s) => s.setDragging);
  const isDragging = useTimeWindowStore((s) => s.isDragging);
  const setWindowThrottled = useTimeWindowStore((s) => s.setWindowThrottled);

  const startSec = win?.startSec ?? 0;
  const endSec = win?.endSec ?? 0;
  const totalSec = win?.totalSec ?? (chartData?.maxT ?? 0);

  const windowMarkLine = React.useMemo(() => {
    if (!win) return undefined;
    return buildWindowMarkLine(startSec, endSec, totalSec);
  }, [win, startSec, endSec, totalSec]);

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
        {
          id: "__preview",
          name: "__preview",
          type: "line",
          data: [],
          silent: true,
          markLine: {
            data: [],
            symbol: "none",
            label: { show: false },
            lineStyle: {
              color: "rgba(46, 18, 230, 0.75)",
              width: 2,
              type: "dashed",
              shadowBlur: 6,
              shadowColor: "rgba(18, 230, 106, 0.9)",
            },
          },
        },
        {
          id: "__climbs",
          name: "__climbs",
          type: "line",
          data: [],
          silent: true,
          markLine: {
            symbol: "none",
            label: { show: false },
            animation: false,
            silent: true,
            data: climbMarkLineData,
          },
        },
      ],
    };
  }, [chartData, baseOption, windowMarkLine, climbMarkLineData]);

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
      xAxis: {
        type: "value",
        min: 0,
        max: chartData.maxT,
        axisLabel: { formatter: (v: number) => fmtTime(v) },
      },
      yAxis: {
        type: "value",
        name: "m/s",
        min: chartData.vMin,
        max: chartData.vMax,
        scale: true,
      },
      dataZoom: VARIO_DATAZOOM,
      series: [
        {
          id: "vario",
          name: `Vario (${varioWindowSec}s)`,
          type: "line",
          data: chartData.vSpeed,
          showSymbol: false,
          lineStyle: { width: 2 },
          markLine: {
            symbol: ["none", "none"],
            lineStyle: { type: "dashed", opacity: 0.6 },
            data: [{ yAxis: 0 }],
          },
        },
        {
          id: "__window",
          name: "__window",
          type: "line",
          data: [],
          silent: true,
          markLine: windowMarkLine,
        },
        {
          id: "__preview",
          name: "__preview",
          type: "line",
          data: [],
          silent: true,
          markLine: {
            data: [],
            symbol: "none",
            label: { show: false },
            lineStyle: {
              color: "rgba(46, 18, 230, 0.75)",
              width: 2,
              type: "dashed",
              shadowBlur: 6,
              shadowColor: "rgba(18, 230, 106, 0.9)",
            },
          },
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
      xAxis: {
        type: "value",
        min: 0,
        max: chartData.maxT,
        axisLabel: { formatter: (v: number) => fmtTime(v) },
      },
      yAxis: { type: "value", name: "km/h", scale: true },
      dataZoom: SPEED_DATAZOOM,
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
        {
          id: "__preview",
          name: "__preview",
          type: "line",
          data: [],
          silent: true,
          markLine: {
            data: [],
            symbol: "none",
            label: { show: false },
            lineStyle: {
              color: "rgba(46, 18, 230, 0.75)",
              width: 2,
              type: "dashed",
              shadowBlur: 6,
              shadowColor: "rgba(18, 230, 106, 0.9)",
            },
          },
        },
      ],
    };
  }, [chartData, baseOption, windowMarkLine]);

  const [showAlt, setShowAlt] = React.useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(SHOW_ALT_KEY);
      if (raw == null) return true;
      return raw === "1";
    } catch {
      return true;
    }
  });

  const [showVario, setShowVario] = React.useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(SHOW_VARIO_KEY);
      if (raw == null) return true;
      return raw === "1";
    } catch {
      return true;
    }
  });

  const [showSpeed, setShowSpeed] = React.useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(SHOW_SPEED_KEY);
      if (raw == null) return true;
      return raw === "1";
    } catch {
      return true;
    }
  });

  React.useEffect(() => {
    try {
      localStorage.setItem(SHOW_ALT_KEY, showAlt ? "1" : "0");
    } catch { }
  }, [showAlt]);

  React.useEffect(() => {
    try {
      localStorage.setItem(SHOW_VARIO_KEY, showVario ? "1" : "0");
    } catch { }
  }, [showVario]);

  React.useEffect(() => {
    try {
      localStorage.setItem(SHOW_SPEED_KEY, showSpeed ? "1" : "0");
    } catch { }
  }, [showSpeed]);

  React.useEffect(() => {
    const a = altInstRef.current;
    const v = varioInstRef.current;
    const s = speedInstRef.current;

    echarts.disconnect(chartGroupId);

    if (!syncEnabled) return;

    const instances: echarts.ECharts[] = [];

    if (showAlt) {
      if (!a) return;
      instances.push(a);
    }
    if (showVario) {
      if (!v) return;
      instances.push(v);
    }
    if (showSpeed) {
      if (!s) return;
      instances.push(s);
    }

    if (instances.length < 2) return;

    for (const inst of instances) {
      inst.group = chartGroupId;
    }

    echarts.connect(chartGroupId);

    return () => {
      echarts.disconnect(chartGroupId);
    };
  }, [chartGroupId, syncEnabled, chartsReadyTick, showAlt, showVario, showSpeed]);

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
            {fmtTime(Math.min(startSec, endSec))} → {fmtTime(Math.max(startSec, endSec))} /{" "}
            {fmtTime(totalSec)}
          </Text>
        </Group>

        <SimpleGrid cols={4} spacing="xs" verticalSpacing="xs">
          <Box>
            <Text size="xs" c="dimmed">
              Dauer
            </Text>
            <Text fw={600}>{dur}</Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">
              Δ Höhe
            </Text>
            <Text fw={600}>{dAlt == null ? "—" : `${fmtSigned(dAlt, 0)} m`}</Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">
              Alt (Start → Ende)
            </Text>
            <Text fw={600}>
              {altStart == null || altEnd == null ? "—" : `${altStart} → ${altEnd} m`}
            </Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">
              Alt (Min / Max)
            </Text>
            <Text fw={600}>{altMin == null || altMax == null ? "—" : `${altMin} / ${altMax} m`}</Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">
              Ø Vario ({varioWindowSec}s)
            </Text>
            <Text fw={600}>{vAvg == null ? "—" : `${vAvg.toFixed(2)} m/s`}</Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">
              Vario (Min / Max)
            </Text>
            <Text fw={600}>
              {vMin == null || vMax == null ? "—" : `${vMin.toFixed(2)} / ${vMax.toFixed(2)} m/s`}
            </Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">
              Ø Speed
            </Text>
            <Text fw={600}>{spAvg == null ? "—" : `${spAvg.toFixed(1)} km/h`}</Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">
              Speed (Max)
            </Text>
            <Text fw={600}>{spMax == null ? "—" : `${spMax.toFixed(1)} km/h`}</Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">
              Climb / Sink / Glide
            </Text>
            <Text fw={600}>
              {pctClimb == null || pctSink == null || pctGlide == null
                ? "—"
                : `${pctClimb.toFixed(0)}% / ${pctSink.toFixed(0)}% / ${pctGlide.toFixed(0)}%`}
            </Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">
              Längste Climb-Phase
            </Text>
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

  const zoomChartsToWindow = React.useCallback(() => {
    const maxT = chartData?.maxT ?? totalSec ?? 0;
    if (!Number.isFinite(maxT) || maxT <= 0) return;

    let zs = Math.min(startSec, endSec);
    let ze = Math.max(startSec, endSec);

    if (!Number.isFinite(zs) || !Number.isFinite(ze) || Math.abs(ze - zs) < 0.0001) {
      zs = 0;
      ze = maxT;
    }

    zs = clamp(zs, 0, maxT);
    ze = clamp(ze, 0, maxT);
    if (ze <= zs) return;

    // (unverändert gelassen, weil bei dir eh “kein Problem”)
    if (showAlt && altInstRef.current) {
      altInstRef.current.dispatchAction?.({ type: "dataZoom", dataZoomIndex: 0, startValue: zs, endValue: ze });
      altInstRef.current.dispatchAction?.({ type: "dataZoom", dataZoomIndex: 1, startValue: zs, endValue: ze });
    }

    if (showVario && varioInstRef.current) {
      varioInstRef.current.dispatchAction?.({ type: "dataZoom", dataZoomIndex: 0, startValue: zs, endValue: ze });
    }

    if (showSpeed && speedInstRef.current) {
      speedInstRef.current.dispatchAction?.({ type: "dataZoom", dataZoomIndex: 0, startValue: zs, endValue: ze });
    }
  }, [chartData?.maxT, totalSec, startSec, endSec, showAlt, showVario, showSpeed]);

  React.useEffect(() => {
    if (!zoomSyncEnabled) return;
    if (!win) return;
    if (isDragging) return; // während drag/preview nicht spammen
    zoomChartsToWindow();
  }, [zoomSyncEnabled, isDragging, zoomChartsToWindow, win]);

  const resetChartsZoom = React.useCallback(() => {
    const maxT = chartData?.maxT ?? totalSec ?? 0;
    if (!Number.isFinite(maxT) || maxT <= 0) return;

    const zs = 0;
    const ze = maxT;

    if (showAlt && altInstRef.current) {
      altInstRef.current.dispatchAction?.({ type: "dataZoom", dataZoomIndex: 0, startValue: zs, endValue: ze });
      altInstRef.current.dispatchAction?.({ type: "dataZoom", dataZoomIndex: 1, startValue: zs, endValue: ze });
    }

    if (showVario && varioInstRef.current) {
      varioInstRef.current.dispatchAction?.({ type: "dataZoom", dataZoomIndex: 0, startValue: zs, endValue: ze });
    }

    if (showSpeed && speedInstRef.current) {
      speedInstRef.current.dispatchAction?.({ type: "dataZoom", dataZoomIndex: 0, startValue: zs, endValue: ze });
    }
  }, [chartData?.maxT, totalSec, showAlt, showVario, showSpeed]);

  const zoomDisabled =
    !chartData ||
    (!showAlt && !showVario && !showSpeed) ||
    (showAlt && !chartReady.alt) ||
    (showVario && !chartReady.vario) ||
    (showSpeed && !chartReady.speed);

  const dragRef = React.useRef<{
    dragging: boolean;
    startT: number | null;
    lastT: number | null;
    owner: ChartKind | null;
  }>({ dragging: false, startT: null, lastT: null, owner: null });

  const getVisibleCharts = React.useCallback(() => {
    const out: Array<{ kind: ChartKind; inst: any }> = [];
    if (showAlt && altInstRef.current) out.push({ kind: "alt", inst: altInstRef.current });
    if (showVario && varioInstRef.current) out.push({ kind: "vario", inst: varioInstRef.current });
    if (showSpeed && speedInstRef.current) out.push({ kind: "speed", inst: speedInstRef.current });
    return out;
  }, [showAlt, showVario, showSpeed]);


  const zoomSyncLockRef = React.useRef(false);

  type ZoomRange =
    | { kind: "value"; startValue: number; endValue: number }
    | { kind: "percent"; start: number; end: number };

  const setAutoFitSelection = useTimeWindowStore((s) => s.setAutoFitSelection);

  const [autoFitSelection, setAutoFitSelectionUi] = React.useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(AUTO_FIT_KEY);
      if (raw == null) return true; // default: an
      return raw === "1";
    } catch {
      return true;
    }
  });

  React.useEffect(() => {
    // store + localstorage synchron halten
    setAutoFitSelection(autoFitSelection);
    try {
      localStorage.setItem(AUTO_FIT_KEY, autoFitSelection ? "1" : "0");
    } catch { }
  }, [autoFitSelection, setAutoFitSelection]);
  const setPreviewLinesAll = React.useCallback(
    (a: number, b: number) => {
      const x1 = Math.min(a, b);
      const x2 = Math.max(a, b);

      for (const { inst } of getVisibleCharts()) {
        try {
          inst.setOption(
            {
              series: [
                {
                  id: "__preview",
                  markLine: { data: [{ xAxis: x1 }, { xAxis: x2 }] },
                },
              ],
            },
            { silent: true }
          );
        } catch { }
      }
    },
    [getVisibleCharts]
  );

  const clearPreviewAll = React.useCallback(() => {
    for (const { inst } of getVisibleCharts()) {
      try {
        inst.setOption(
          {
            series: [
              {
                id: "__preview",
                markLine: { data: [] },
              },
            ],
          },
          { silent: true }
        );
      } catch { }
    }
  }, [getVisibleCharts]);

  // ✅ FIX (minimal): during Shift-range-select disable inside-dataZoom so chart does NOT pan/move
  const setPanEnabled = React.useCallback((kind: ChartKind, enabled: boolean) => {
    const inst = kind === "alt" ? altInstRef.current : kind === "vario" ? varioInstRef.current : speedInstRef.current;
    if (!inst) return;

    const dzId = kind === "alt" ? "dz_inside_alt" : kind === "vario" ? "dz_inside_vario" : "dz_inside_speed";

    try {
      inst.setOption(
        {
          dataZoom: [
            {
              id: dzId,
              // keep your existing config, but hard-disable interaction during selection
              disabled: !enabled,
              moveOnMouseMove: enabled,
            },
          ],
        },
        { silent: true }
      );
    } catch { }
  }, []);

  const resetSelection = React.useCallback(() => {
    setWindow(null);
    setDragging(false);

    dragRef.current.dragging = false;
    dragRef.current.startT = null;
    dragRef.current.lastT = null;
    dragRef.current.owner = null;

    clearPreviewAll();
    resetChartsZoom();
  }, [setWindow, setDragging, clearPreviewAll, resetChartsZoom]);

  const isSelectGesture = (ev: any) => {
    const e = ev?.event ?? ev;
    return !!e?.shiftKey;
  };

  // ✅ FIX (minimal): stop event harder (prevents ECharts from also handling drag)
  const stopEvent = (ev: any) => {
    const e = ev?.event ?? ev;
    e?.preventDefault?.();
    e?.stopPropagation?.();
    e?.stopImmediatePropagation?.();
  };

  const attachRangeSelect = React.useCallback(
    (kind: ChartKind) => {
      const inst = kind === "alt" ? altInstRef.current : kind === "vario" ? varioInstRef.current : speedInstRef.current;
      if (!inst) return;

      const zr = inst.getZr?.();
      if (!zr) return;

      const getXY = (ev: any) => {
        const ox = ev?.offsetX;
        const oy = ev?.offsetY;
        if (typeof ox === "number" && typeof oy === "number") return { x: ox, y: oy };

        const ne = ev?.event;
        const x2 = ne?.offsetX;
        const y2 = ne?.offsetY;
        if (typeof x2 === "number" && typeof y2 === "number") return { x: x2, y: y2 };

        return null;
      };

      const pxToT = (x: number, y: number) => {
        try {
          const v = inst.convertFromPixel({ gridIndex: 0 }, [x, y]);
          const t = Array.isArray(v) ? v[0] : v;
          return typeof t === "number" && Number.isFinite(t) ? t : null;
        } catch {
          return null;
        }
      };

      const onDown = (ev: any) => {
        if (!isSelectGesture(ev)) return;

        if (dragRef.current.dragging && dragRef.current.owner && dragRef.current.owner !== kind) return;

        stopEvent(ev);

        const xy = getXY(ev);
        if (!xy) return;

        const t = pxToT(xy.x, xy.y);
        if (t == null) return;

        dragRef.current.dragging = true;
        dragRef.current.owner = kind;
        dragRef.current.startT = t;
        dragRef.current.lastT = t;

        setDragging(true);

        const maxT = chartData?.maxT ?? totalSec ?? 0;

        setWindowThrottled({
          startSec: t,
          endSec: t,
          totalSec: Number.isFinite(maxT) && maxT > 0 ? maxT : t,
        });

        // ✅ key change: disable inside-dataZoom so the chart doesn't pan while selecting
        setPanEnabled(kind, false);

        setPreviewLinesAll(t, t);
      };

      const onMove = (ev: any) => {
        if (!dragRef.current.dragging) return;
        if (dragRef.current.owner !== kind) return;

        stopEvent(ev);

        const xy = getXY(ev);
        if (!xy) return;

        const t = pxToT(xy.x, xy.y);
        if (t == null) return;

        dragRef.current.lastT = t;

        const s0 = dragRef.current.startT;
        const s1 = dragRef.current.lastT;
        if (s0 != null && s1 != null) {
          setPreviewLinesAll(s0, s1);

          const a = Math.min(s0, s1);
          const b = Math.max(s0, s1);
          const maxT = chartData?.maxT ?? totalSec ?? 0;

          setWindowThrottled({
            startSec: a,
            endSec: b,
            totalSec: Number.isFinite(maxT) && maxT > 0 ? maxT : b,
          });
        }
      };

      const onUp = (ev: any) => {
        if (!dragRef.current.dragging) return;
        if (dragRef.current.owner !== kind) return;

        stopEvent(ev);

        const xy = getXY(ev);
        const t = xy ? pxToT(xy.x, xy.y) : null;
        if (t != null) dragRef.current.lastT = t;

        dragRef.current.dragging = false;

        setDragging(false);

        const startT = dragRef.current.startT;
        const lastT = dragRef.current.lastT;

        // ✅ restore inside-dataZoom
        setPanEnabled(kind, true);

        const maxT = chartData?.maxT ?? totalSec ?? 0;

        if (startT == null || lastT == null) {
          clearPreviewAll();
          dragRef.current.startT = null;
          dragRef.current.lastT = null;
          dragRef.current.owner = null;
          return;
        }

        let a = Math.min(startT, lastT);
        let b = Math.max(startT, lastT);

        if (Number.isFinite(maxT) && maxT > 0) {
          a = clamp(a, 0, maxT);
          b = clamp(b, 0, maxT);
        }

        const MIN_RANGE_SEC = 1.0;
        if (b - a < MIN_RANGE_SEC) {
          clearPreviewAll();
          dragRef.current.startT = null;
          dragRef.current.lastT = null;
          dragRef.current.owner = null;
          return;
        }

        setWindow({
          startSec: a,
          endSec: b,
          totalSec: Number.isFinite(maxT) && maxT > 0 ? maxT : b,
        });

        clearPreviewAll();

        dragRef.current.startT = null;
        dragRef.current.lastT = null;
        dragRef.current.owner = null;
      };

      const onGlobalOut = () => {
        if (!dragRef.current.dragging) return;
        if (dragRef.current.owner !== kind) return;

        dragRef.current.dragging = false;
        dragRef.current.startT = null;
        dragRef.current.lastT = null;

        setDragging(false);

        // ✅ restore inside-dataZoom
        setPanEnabled(kind, true);

        clearPreviewAll();

        setWindow(null);

        dragRef.current.owner = null;
      };

      zr.on("mousedown", onDown);
      zr.on("mousemove", onMove);
      zr.on("mouseup", onUp);
      zr.on("globalout", onGlobalOut);

      return () => {
        zr.off("mousedown", onDown);
        zr.off("mousemove", onMove);
        zr.off("mouseup", onUp);
        zr.off("globalout", onGlobalOut);
      };
    },
    [
      chartData?.maxT,
      totalSec,
      setDragging,
      setPanEnabled,
      setPreviewLinesAll,
      clearPreviewAll,
      setWindow,
      setWindowThrottled,
    ]
  );

  React.useEffect(() => {
    if (!zoomSyncEnabled) return;

    const pickZoomRangeFromEvent = (e: any): ZoomRange | null => {
      const b0 = e?.batch?.[0];
      if (!b0) return null;

      const sv = b0.startValue;
      const ev = b0.endValue;
      if (typeof sv === "number" && Number.isFinite(sv) && typeof ev === "number" && Number.isFinite(ev)) {
        return { kind: "value", startValue: sv, endValue: ev };
      }

      const sp = b0.start;
      const ep = b0.end;
      if (typeof sp === "number" && Number.isFinite(sp) && typeof ep === "number" && Number.isFinite(ep)) {
        return { kind: "percent", start: sp, end: ep };
      }

      return null;
    }


    const applyZoomRangeToChart = (inst: any, kind: ChartKind, r: ZoomRange) => {
      if (!inst) return;

      const idxs = kind === "alt" ? [0, 1] : [0]; // alt: inside + slider, vario/speed: nur inside

      for (const dataZoomIndex of idxs) {
        if (r.kind === "value") {
          inst.dispatchAction?.({
            type: "dataZoom",
            dataZoomIndex,
            startValue: r.startValue,
            endValue: r.endValue,
          });
        } else {
          inst.dispatchAction?.({
            type: "dataZoom",
            dataZoomIndex,
            start: r.start,
            end: r.end,
          });
        }
      }
    }

    const visibles = getVisibleCharts();
    if (visibles.length < 2) return;

    const cleanups: Array<() => void> = [];

    for (const { inst } of visibles) {
      const onDataZoom = (e: any) => {
        // während Range-Select / Preview nicht syncen (sonst fighten Events)
        if (isDragging) return;

        if (zoomSyncLockRef.current) return;

        const r = pickZoomRangeFromEvent(e);
        if (!r) return;

        zoomSyncLockRef.current = true;
        try {
          for (const other of visibles) {
            if (other.inst === inst) continue;
            applyZoomRangeToChart(other.inst, other.kind, r);
          }
        } finally {
          // lock im nächsten Tick lösen (sonst immediate feedback loop)
          queueMicrotask(() => {
            zoomSyncLockRef.current = false;
          });
        }
      };

      inst.on?.("dataZoom", onDataZoom);
      cleanups.push(() => inst.off?.("dataZoom", onDataZoom));
    }

    return () => {
      for (const fn of cleanups) fn();
    };
  }, [zoomSyncEnabled, getVisibleCharts, isDragging, chartsReadyTick]);


  React.useEffect(() => {
    const cleanups: Array<(() => void) | undefined> = [];

    if (showAlt && altInstRef.current) cleanups.push(attachRangeSelect("alt"));
    if (showVario && varioInstRef.current) cleanups.push(attachRangeSelect("vario"));
    if (showSpeed && speedInstRef.current) cleanups.push(attachRangeSelect("speed"));

    return () => {
      for (const fn of cleanups) fn?.();
    };
  }, [showAlt, showVario, showSpeed, chartsReadyTick, attachRangeSelect]);

  return (
    <Box p="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Button variant="light" onClick={() => window.history.back()}>
            Back
          </Button>

          <Group gap="md" align="center">

            <Checkbox
              label="Auto fit"
              checked={autoFitSelection}
              onChange={(e) => setAutoFitSelectionUi(e.currentTarget.checked)}
            />

            <Checkbox
              label="Sync chart zoom"
              checked={zoomSyncEnabled}
              onChange={(e) => setZoomSyncEnabled(e.currentTarget.checked)}
            />

            <Button size="xs" variant="light" onClick={resetSelection} disabled={!win}>
              Reset selection
            </Button>

            <Checkbox
              label="Topo"
              checked={baseMap === "topo"}
              onChange={(e) => setBaseMap(e.currentTarget.checked ? "topo" : "osm")}
            />

            <Button size="xs" variant="light" onClick={zoomChartsToWindow} disabled={zoomDisabled}>
              Zoom to window
            </Button>

            <Checkbox label="Charts sync" checked={syncEnabled} onChange={(e) => setSyncEnabled(e.currentTarget.checked)} />
            <Checkbox label="Follow marker" checked={followEnabled} onChange={(e) => setFollowEnabled(e.currentTarget.checked)} />
            <Checkbox label="Show stats" checked={showStats} onChange={(e) => setShowStats(e.currentTarget.checked)} />

            <Checkbox
              label="Alt"
              checked={showAlt}
              onChange={(e) => {
                const next = e.currentTarget.checked;
                setShowAlt(next);
                if (!next) {
                  altInstRef.current = null;
                  setChartReady((r) => ({ ...r, alt: false }));
                  setChartsReadyTick((x) => x + 1);
                }
              }}
            />
            <Checkbox
              label="Vario"
              checked={showVario}
              onChange={(e) => {
                const next = e.currentTarget.checked;
                setShowVario(next);
                if (!next) {
                  varioInstRef.current = null;
                  setChartReady((r) => ({ ...r, vario: false }));
                  setChartsReadyTick((x) => x + 1);
                }
              }}
            />

            <Checkbox
              label="Speed"
              checked={showSpeed}
              onChange={(e) => {
                const next = e.currentTarget.checked;
                setShowSpeed(next);
                if (!next) {
                  speedInstRef.current = null;
                  setChartReady((r) => ({ ...r, speed: false }));
                  setChartsReadyTick((x) => x + 1);
                }
              }}
            />

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
            <Box
              style={{
                width: `${splitPct}%`,
                paddingRight: 12,
                minWidth: 320,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              {StatsPanel}

              <Box
                style={{
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {showAlt && (
                  <Box style={{ flex: 1, minHeight: 140 }}>
                    <Text size="sm" fw={600} mb={4}>
                      Altitude
                    </Text>
                    <EChartsReact
                      onEvents={chartEvents}
                      echarts={echarts}
                      option={altOption}
                      style={{ height: "100%", width: "100%" }}
                      notMerge={false}
                      onChartReady={(inst) => {
                        altInstRef.current = inst;
                        inst.group = chartGroupId;
                        setChartReady((r) => ({ ...r, alt: true }));
                        setChartsReadyTick((x) => x + 1);
                      }}
                    />
                  </Box>
                )}

                {showVario && (
                  <Box style={{ flex: 1, minHeight: 140 }}>
                    <Text size="sm" fw={600} mb={4}>
                      Vertical speed (Vario)
                    </Text>
                    <EChartsReact
                      onEvents={chartEvents}
                      echarts={echarts}
                      option={varioOption}
                      style={{ height: "100%", width: "100%" }}
                      notMerge={false}
                      onChartReady={(inst) => {
                        varioInstRef.current = inst;
                        inst.group = chartGroupId;
                        setChartReady((r) => ({ ...r, vario: true }));
                        setChartsReadyTick((x) => x + 1);
                      }}
                    />
                  </Box>
                )}

                {showSpeed && (
                  <Box style={{ flex: 1, minHeight: 140 }}>
                    <Text size="sm" fw={600} mb={4}>
                      Horizontal speed
                    </Text>
                    <EChartsReact
                      onEvents={chartEvents}
                      echarts={echarts}
                      option={speedOption}
                      style={{ height: "100%", width: "100%" }}
                      notMerge={false}
                      onChartReady={(inst) => {
                        speedInstRef.current = inst;
                        inst.group = chartGroupId;
                        setChartReady((r) => ({ ...r, speed: true }));
                        setChartsReadyTick((x) => x + 1);
                      }}
                    />
                  </Box>
                )}

                {!showAlt && !showVario && !showSpeed && (
                  <Paper withBorder p="md" radius="md">
                    <Text c="dimmed" size="sm">
                      No charts selected.
                    </Text>
                  </Paper>
                )}
              </Box>
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
                <FlightMap
                  fixesFull={computedWithLite?.fixesFull ?? []}
                  fixesLite={computedWithLite?.fixesLite ?? []}
                  baseMap={baseMap}
                  watchKey={`${id}-${baseMap}`}
                  followEnabled={followEnabled}
                />
              </Box>
            </Box>
          </Box>
        )}
      </Stack>
    </Box>
  );
}
