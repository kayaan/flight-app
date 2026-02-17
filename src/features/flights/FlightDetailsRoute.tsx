// src/features/flights/FlightDetailsRoute.tsx
// ✅ Implemented: KPI tile StatsPanel (clean scanable layout + optional details row)

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
  ActionIcon,
  Divider,
  Drawer,
  Chip,
  Badge,
} from "@mantine/core";
import { IconAlertCircle, IconSettings } from "@tabler/icons-react";
import EChartsReact from "echarts-for-react";
import * as echarts from "echarts";

import type { FlightRecordDetails } from "./flights.types";
import { buildFlightSeries, calculationWindow, parseIgcFixes } from "./igc/igc.series";
import { useAuthStore } from "../auth/store/auth.store";
import { flightApi } from "./flights.api";
import type { FixPoint, SeriesPoint } from "./igc";

import { FlightMap } from "./map/FlightMapBase";
import { useFlightHoverStore } from "./store/flightHover.store";
import { useTimeWindowStore } from "./store/timeWindow.store";
import { detectClimbPhases } from "./analysis/turns/detectClimbPhases";
import { useFlightDetailsUiStore, type BaseMap as UiBaseMap } from "./store/flightDetailsUi.store";
import { detectThermalCirclesInClimbs, type ThermalCircle } from "./analysis/turns/detectThermalCircles";

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

function buildActiveRangeMarkLine(range: { startSec: number; endSec: number } | null) {
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

function buildClimbLinesSeries(enabled: boolean, climbMarkLineData: any[]) {
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
const EMPTY_FIXES: FixPoint[] = [];
const EMPTY_THERMALS: ThermalCircle[] = [];

const ALT_DATAZOOM = [
  { id: "dz_inside_alt", type: "inside", xAxisIndex: 0, moveOnMouseMove: true },
  { id: "dz_slider_alt", type: "slider", xAxisIndex: 0, height: 20, bottom: 8 },
] as const;

const VARIO_DATAZOOM = [{ id: "dz_inside_vario", type: "inside", xAxisIndex: 0, moveOnMouseMove: true }] as const;
const SPEED_DATAZOOM = [{ id: "dz_inside_speed", type: "inside", xAxisIndex: 0, moveOnMouseMove: true }] as const;

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
  const colors = ["#ff006e", "#fb5607", "#ffbe0b", "#8338ec", "#3a86ff", "#06d6a0", "#ef476f", "#118ab2"];
  return colors[i % colors.length];
}

type ChartKind = "alt" | "vario" | "speed";

export function FlightDetailsRoute() {
  const token = useAuthStore((s) => s.token);
  const { id } = useParams({ from: "/flights/$id" });

  // ✅ UI from store (persisted)
  const autoFitSelection = useFlightDetailsUiStore((s) => s.autoFitSelection);
  const zoomSyncEnabled = useFlightDetailsUiStore((s) => s.zoomSyncEnabled);
  const syncEnabled = useFlightDetailsUiStore((s) => s.syncEnabled);
  const followEnabled = useFlightDetailsUiStore((s) => s.followEnabled);
  const showStats = useFlightDetailsUiStore((s) => s.showStats);

  const showAlt = useFlightDetailsUiStore((s) => s.showAlt);
  const showVario = useFlightDetailsUiStore((s) => s.showVario);
  const showSpeed = useFlightDetailsUiStore((s) => s.showSpeed);

  const varioWindowSec = useFlightDetailsUiStore((s) => s.varioWindowSec);
  const baseMap = useFlightDetailsUiStore((s) => s.baseMap);

  const setAutoFitSelectionUi = useFlightDetailsUiStore((s) => s.setAutoFitSelection);
  const setZoomSyncEnabled = useFlightDetailsUiStore((s) => s.setZoomSyncEnabled);
  const setSyncEnabled = useFlightDetailsUiStore((s) => s.setSyncEnabled);
  const setFollowEnabled = useFlightDetailsUiStore((s) => s.setFollowEnabled);
  const setShowStats = useFlightDetailsUiStore((s) => s.setShowStats);


  const setVarioWindowSec = useFlightDetailsUiStore((s) => s.setVarioWindowSec);
  const setBaseMap = useFlightDetailsUiStore((s) => s.setBaseMap);

  // keep TimeWindow-store synced (AutoFit logic lives there)
  const setAutoFitSelectionInWindowStore = useTimeWindowStore((s) => s.setAutoFitSelection);
  React.useEffect(() => {
    setAutoFitSelectionInWindowStore(autoFitSelection);
  }, [autoFitSelection, setAutoFitSelectionInWindowStore]);

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

  const chartGroupId = React.useMemo(() => `flight-${id}-charts`, [id]);

  const altInstRef = React.useRef<any>(null);
  const varioInstRef = React.useRef<any>(null);
  const speedInstRef = React.useRef<any>(null);
  const [chartsReadyTick, setChartsReadyTick] = React.useState(0);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const draggingRef = React.useRef(false);
  const [splitPct, setSplitPct] = React.useState<number>(60);

  const showClimbLinesOnChart = useFlightDetailsUiStore((s) => s.showClimbLinesOnChart);
  const showThermalsOnMap = useFlightDetailsUiStore((s) => s.showThermalsOnMap);

  const setShowClimbLinesOnChart = useFlightDetailsUiStore((s) => s.setShowClimbLinesOnChart);
  const setShowThermalsOnMap = useFlightDetailsUiStore((s) => s.setShowThermalsOnMap);

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
    const climbPhases = detectClimbPhases(f, {
      startGainM: 15,
      minGainM: 100,
      dropPct: 0.3,
      minDropAbsM: 75,
      minLenPts: 25,
    });

    return climbPhases;
  }, [computed?.fixesFull]);

  const [activeClimbIndex, setActiveClimbIndex] = React.useState<number | null>(null);

  const hasClimbs = climbs.length > 0;
  const climbNavActive = activeClimbIndex != null && hasClimbs;

  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [mapFocusKey, setMapFocusKey] = React.useState(0);
  const [pulseActive, setPulseActive] = React.useState(false);

  // kleine UX-Pulse helper
  const pulse = React.useCallback(() => {
    setPulseActive(true);
    window.setTimeout(() => setPulseActive(false), 260);
  }, []);

  const clearActiveClimb = React.useCallback(() => {
    setActiveClimbIndex(null);
  }, []);

  const prevClimb = React.useCallback(() => {
    if (!hasClimbs) return;
    setActiveClimbIndex((prev) => {
      if (prev == null) return climbs.length - 1; // wenn nix aktiv: spring ans Ende
      return (prev - 1 + climbs.length) % climbs.length;
    });
  }, [hasClimbs, climbs.length]);

  const nextClimb = React.useCallback(() => {
    if (!hasClimbs) return;
    setActiveClimbIndex((prev) => {
      if (prev == null) return 0; // wenn nix aktiv: starte bei 0
      return (prev + 1) % climbs.length;
    });
  }, [hasClimbs, climbs.length]);


  React.useEffect(() => {
    if (!climbs.length) {
      setActiveClimbIndex(null);
      return;
    }
    setActiveClimbIndex((prev) => {
      if (prev == null) return prev;
      return clamp(prev, 0, climbs.length - 1);
    });
  }, [climbs.length]);

  const thermals = React.useMemo(() => {
    const f = computed?.fixesFull ?? null;
    if (!f) return [];
    if (!climbs.length) return [];

    return detectThermalCirclesInClimbs(f, climbs, {
      windowPts: 40,
      stepPts: 6,
      minTurnDeg: 270,
      minRadiusM: 20,
      maxRadiusM: 160,
      maxRadiusSlackM: 90,
      maxRadiusRelStd: 0.5,
      minSignConsistency: 0.45,
      minAltGainM: 8,
      mergeGapPts: 12,
      backtrackPts: 8,
    });
  }, [computed?.fixesFull, climbs]);

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

      data.push({
        xAxis: startSec,
        lineStyle: { color, width: 2, opacity: 0.9 },
        label: { show: false },
      });

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

  const winStartSec = win?.startSec ?? 0;
  const winEndSec = win?.endSec ?? 0;
  const winTotalSec = win?.totalSec ?? (chartData?.maxT ?? 0);

  const activeClimb = React.useMemo(() => {
    if (activeClimbIndex == null) return null;
    if (!climbs.length) return null;
    const i = clamp(activeClimbIndex, 0, climbs.length - 1);
    return climbs[i] ?? null;
  }, [activeClimbIndex, climbs]);

  const thermalCount = thermals?.length ?? 0;

  const activeClimbGainM = React.useMemo(() => {
    if (!activeClimb) return null;
    return Number.isFinite(activeClimb.gainM) ? activeClimb.gainM : null;
  }, [activeClimb]);

  const activeClimbDurSec = React.useMemo(() => {
    if (!activeClimb || !computed?.fixesFull?.length) return null;
    const f = computed.fixesFull;
    const s = f[activeClimb.startIdx]?.tSec;
    const e = f[activeClimb.endIdx]?.tSec;
    if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
    return Math.max(0, Math.abs((e as number) - (s as number)));
  }, [activeClimb, computed?.fixesFull]);

  const activeClimbOverlay = React.useMemo(() => {
    const f = computed?.fixesFull ?? null;
    if (!activeClimb || !f) return null;

    const s = f[activeClimb.startIdx]?.tSec;
    const e = f[activeClimb.endIdx]?.tSec;
    if (!Number.isFinite(s) || !Number.isFinite(e)) return null;

    const a = Math.min(s as number, e as number);
    const b = Math.max(s as number, e as number);

    return {
      startSec: a,
      endSec: b,
    };
  }, [computed?.fixesFull, activeClimb]);

  const activeRange = React.useMemo(() => {
    if (!activeClimb || !computed?.fixesFull?.length) return null;

    const f = computed.fixesFull;

    const s = f[activeClimb.startIdx]?.tSec;
    const e = f[activeClimb.endIdx]?.tSec;

    if (!Number.isFinite(s) || !Number.isFinite(e)) return null;

    return { startSec: s as number, endSec: e as number };
  }, [activeClimb, computed?.fixesFull]);

  const statsSource = activeClimb ? ("climb" as const) : ("window" as const);

  const statsRange = React.useMemo(() => {
    const f = computed?.fixesFull ?? null;
    if (activeClimb && f) {
      const s = f[activeClimb.startIdx]?.tSec;
      const e = f[activeClimb.endIdx]?.tSec;
      if (Number.isFinite(s) && Number.isFinite(e)) {
        return { startSec: s as number, endSec: e as number };
      }
    }
    return { startSec: winStartSec, endSec: winEndSec };
  }, [computed?.fixesFull, activeClimb, winStartSec, winEndSec]);

  const windowMarkLine = React.useMemo(() => {
    if (!win) return undefined;
    return buildWindowMarkLine(winStartSec, winEndSec, winTotalSec);
  }, [win, winStartSec, winEndSec, winTotalSec]);

  const segmentStats = React.useMemo(() => {
    if (!computed?.series || !chartData?.vSpeed) return null;
    return computeSegmentStats(computed.series, chartData.vSpeed, statsRange.startSec, statsRange.endSec);
  }, [computed?.series, chartData?.vSpeed, statsRange.startSec, statsRange.endSec]);

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
        { id: "alt", name: "Altitude", type: "line", data: chartData.alt, showSymbol: false, lineStyle: { width: 2 } },
        { id: "__window", name: "__window", type: "line", data: [], silent: true, markLine: windowMarkLine },
        {
          id: "__activeClimb",
          name: "__activeClimb",
          type: "line",
          data: [],
          silent: true,
          z: 10,
          markArea: activeClimbOverlay
            ? {
              silent: true,
              itemStyle: { color: "rgba(255, 77, 79, 0.10)" },
              data: [[{ xAxis: activeClimbOverlay.startSec }, { xAxis: activeClimbOverlay.endSec }]],
            }
            : undefined,
          markLine: activeClimbOverlay
            ? {
              silent: true,
              symbol: "none",
              label: { show: false },
              lineStyle: { color: "rgba(255, 77, 79, 0.95)", width: 3 },
              data: [{ xAxis: activeClimbOverlay.startSec }, { xAxis: activeClimbOverlay.endSec }],
            }
            : undefined,
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
        ...buildClimbLinesSeries(showClimbLinesOnChart, climbMarkLineData),
        ...buildActiveRangeMarkLine(activeRange),
      ],
    };
  }, [chartData, baseOption, windowMarkLine, climbMarkLineData, showClimbLinesOnChart, activeClimbOverlay, activeRange]);

  const varioOption = React.useMemo(() => {
    if (!chartData) return {};
    return {
      ...baseOption,
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "cross",
          lineStyle: { color: "rgba(255, 77, 79, 0.9)", width: 1.5, type: "dashed", dashOffset: 0 },
          label: {
            show: true,
            formatter: (params: AxisPointerLabelParams) => {
              if (params.axisDimension === "x") return (params.value as number).toFixed(0) + " s";
              if (params.axisDimension === "y") return (params.value as number).toFixed(1) + " m/s";
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
      dataZoom: VARIO_DATAZOOM,
      series: [
        {
          id: "vario",
          name: `Vario (${varioWindowSec}s)`,
          type: "line",
          data: chartData.vSpeed,
          showSymbol: false,
          lineStyle: { width: 2 },
          markLine: { symbol: ["none", "none"], lineStyle: { type: "dashed", opacity: 0.6 }, data: [{ yAxis: 0 }] },
        },
        {
          id: "__activeClimb",
          name: "__activeClimb",
          type: "line",
          data: [],
          silent: true,
          z: 10,
          markArea: activeClimbOverlay
            ? {
              silent: true,
              itemStyle: { color: "rgba(255, 77, 79, 0.10)" },
              data: [[{ xAxis: activeClimbOverlay.startSec }, { xAxis: activeClimbOverlay.endSec }]],
            }
            : undefined,
          markLine: activeClimbOverlay
            ? {
              silent: true,
              symbol: "none",
              label: { show: false },
              lineStyle: { color: "rgba(255, 77, 79, 0.95)", width: 3 },
              data: [{ xAxis: activeClimbOverlay.startSec }, { xAxis: activeClimbOverlay.endSec }],
            }
            : undefined,
        },
        { id: "__window", name: "__window", type: "line", data: [], silent: true, markLine: windowMarkLine },
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
        ...buildClimbLinesSeries(showClimbLinesOnChart, climbMarkLineData),
        ...buildActiveRangeMarkLine(activeRange),
      ],
    };
  }, [chartData, baseOption, windowMarkLine, varioWindowSec, activeRange, climbMarkLineData, showClimbLinesOnChart, activeClimbOverlay]);

  const speedOption = React.useMemo(() => {
    if (!chartData) return {};
    return {
      ...baseOption,
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "cross",
          lineStyle: { color: "rgba(255, 77, 79, 0.9)", width: 1.5, type: "dashed", dashOffset: 0 },
          label: {
            show: true,
            formatter: (params: AxisPointerLabelParams) => {
              if (params.axisDimension === "x") return (params.value as number).toFixed(0) + " s";
              if (params.axisDimension === "y") return (params.value as number).toFixed(0) + " km/h";
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
      dataZoom: SPEED_DATAZOOM,
      series: [
        { id: "speed", name: "Ground speed", type: "line", data: chartData.hSpeed, showSymbol: false, lineStyle: { width: 2 } },
        { id: "__window", name: "__window", type: "line", data: [], silent: true, markLine: windowMarkLine },
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
          id: "__activeClimb",
          name: "__activeClimb",
          type: "line",
          data: [],
          silent: true,
          z: 10,
          markArea: activeClimbOverlay
            ? {
              silent: true,
              itemStyle: { color: "rgba(255, 77, 79, 0.10)" },
              data: [[{ xAxis: activeClimbOverlay.startSec }, { xAxis: activeClimbOverlay.endSec }]],
            }
            : undefined,
          markLine: activeClimbOverlay
            ? {
              silent: true,
              symbol: "none",
              label: { show: false },
              lineStyle: { color: "rgba(255, 77, 79, 0.95)", width: 3 },
              data: [{ xAxis: activeClimbOverlay.startSec }, { xAxis: activeClimbOverlay.endSec }],
            }
            : undefined,
        },
        ...buildClimbLinesSeries(showClimbLinesOnChart, climbMarkLineData),
        ...buildActiveRangeMarkLine(activeRange),
      ],
    };
  }, [chartData, baseOption, windowMarkLine, activeRange, climbMarkLineData, showClimbLinesOnChart, activeClimbOverlay]);

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

    for (const inst of instances) inst.group = chartGroupId;
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

  // ✅ KPI helper (local)
  const KpiCard = React.useCallback(
    ({
      label,
      value,
      sub,
    }: {
      label: string;
      value: React.ReactNode;
      sub?: React.ReactNode;
    }) => {
      return (
        <Paper withBorder p="sm" radius="md" style={{ height: "100%" }}>
          <Text size="xs" c="dimmed">
            {label}
          </Text>
          <Text fw={800} size="lg" style={{ lineHeight: 1.15 }}>
            {value}
          </Text>
          {sub != null && (
            <Text size="xs" c="dimmed" mt={4} style={{ lineHeight: 1.2 }}>
              {sub}
            </Text>
          )}
        </Paper>
      );
    },
    []
  );

  // ✅ improved Stats panel: KPI tiles + optional detail row
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

    const rangeStart = fmtTime(Math.min(statsRange.startSec, statsRange.endSec));
    const rangeEnd = fmtTime(Math.max(statsRange.startSec, statsRange.endSec));
    const totalTxt = fmtTime(winTotalSec);

    const modeLabel =
      statsSource === "climb" && climbNavActive
        ? `Climb ${activeClimbIndex! + 1}/${climbs.length}`
        : "Window";

    const mixText =
      pctClimb == null || pctSink == null || pctGlide == null
        ? "—"
        : `${pctClimb.toFixed(0)}% / ${pctSink.toFixed(0)}% / ${pctGlide.toFixed(0)}%`;

    const mixPrimary =
      pctClimb == null
        ? "—"
        : `Climb ${pctClimb.toFixed(0)}%`;

    const mixSub =
      pctSink == null || pctGlide == null
        ? undefined
        : `Sink ${pctSink.toFixed(0)}% · Glide ${pctGlide.toFixed(0)}%`;

    return (
      <Paper withBorder p="sm" radius="md">
        <Group justify="space-between" align="center" mb="xs" wrap="nowrap">
          <Group gap="xs" align="center" wrap="nowrap">
            <Text fw={700} size="sm">
              Stats
            </Text>
            <Badge variant="light" color={statsSource === "climb" ? "yellow" : "gray"}>
              {modeLabel}
            </Badge>
          </Group>

          <Text size="xs" c="dimmed" style={{ textAlign: "right" }}>
            {rangeStart} → {rangeEnd} / {totalTxt}
          </Text>
        </Group>

        {/* KPI tiles */}
        <SimpleGrid
          cols={{ base: 2, sm: 3, lg: 6 }}
          spacing="xs"
          verticalSpacing="xs"
        >
          <KpiCard
            label="Δ Altitude"
            value={dAlt == null ? "—" : `${fmtSigned(dAlt, 0)} m`}
            sub={altMin == null || altMax == null ? undefined : `Min/Max: ${altMin} / ${altMax} m`}
          />

          <KpiCard
            label="Duration"
            value={dur}
            sub={altStart == null || altEnd == null ? undefined : `Alt: ${altStart} → ${altEnd} m`}
          />

          <KpiCard
            label={`Avg vario (${varioWindowSec}s)`}
            value={vAvg == null ? "—" : `${vAvg.toFixed(1)} m/s`}
            sub={vMin == null || vMax == null ? undefined : `Min/Max: ${vMin.toFixed(1)} / ${vMax.toFixed(1)}`}
          />

          <KpiCard
            label="Avg speed"
            value={spAvg == null ? "—" : `${spAvg.toFixed(1)} km/h`}
            sub={spMax == null ? undefined : `Max: ${spMax.toFixed(1)} km/h`}
          />

          <KpiCard
            label="Altitude start"
            value={altStart == null ? "—" : `${altStart} m`}
            sub={altEnd == null ? undefined : `End: ${altEnd} m`}
          />

          <KpiCard
            label="Phase mix"
            value={mixPrimary}
            sub={mixSub ?? `Climb/Sink/Glide: ${mixText}`}
          />
        </SimpleGrid>

        {/* Details row (still compact) */}
        <Divider my="sm" />

        <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="xs" verticalSpacing="xs">
          <Box>
            <Text size="xs" c="dimmed">Altitude (Min / Max)</Text>
            <Text fw={600}>{altMin == null || altMax == null ? "—" : `${altMin} / ${altMax} m`}</Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">Vario (Min / Max)</Text>
            <Text fw={600}>{vMin == null || vMax == null ? "—" : `${vMin.toFixed(1)} / ${vMax.toFixed(1)} m/s`}</Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">Speed (Avg / Max)</Text>
            <Text fw={600}>
              {spAvg == null ? "—" : spAvg.toFixed(1)} / {spMax == null ? "—" : spMax.toFixed(1)} km/h
            </Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">Climb / Sink / Glide</Text>
            <Text fw={600}>{mixText}</Text>
          </Box>

          <Box>
            <Text size="xs" c="dimmed">Longest climb phase</Text>
            <Text fw={600}>
              {bestClimbT == null || bestClimbDAlt == null ? "—" : `${fmtTime(bestClimbT)} (${fmtSigned(bestClimbDAlt, 0)} m)`}
            </Text>
          </Box>
        </SimpleGrid>
      </Paper>
    );
  }, [
    showStats,
    segmentStats,
    varioWindowSec,
    statsSource,
    climbNavActive,
    activeClimbIndex,
    climbs.length,
    statsRange.startSec,
    statsRange.endSec,
    winTotalSec,
    KpiCard,
  ]);

  const zoomChartsToWindow = React.useCallback(() => {
    const maxT = chartData?.maxT ?? winTotalSec ?? 0;
    if (!Number.isFinite(maxT) || maxT <= 0) return;

    let zs = Math.min(winStartSec, winEndSec);
    let ze = Math.max(winStartSec, winEndSec);

    if (!Number.isFinite(zs) || !Number.isFinite(ze) || Math.abs(ze - zs) < 0.0001) {
      zs = 0;
      ze = maxT;
    }

    zs = clamp(zs, 0, maxT);
    ze = clamp(ze, 0, maxT);
    if (ze <= zs) return;

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
  }, [chartData?.maxT, winTotalSec, winStartSec, winEndSec, showAlt, showVario, showSpeed]);

  React.useEffect(() => {
    if (!zoomSyncEnabled) return;
    if (!win) return;
    if (isDragging) return;
    zoomChartsToWindow();
  }, [zoomSyncEnabled, isDragging, zoomChartsToWindow, win]);

  const resetChartsZoom = React.useCallback(() => {
    const maxT = chartData?.maxT ?? winTotalSec ?? 0;
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
  }, [chartData?.maxT, winTotalSec, showAlt, showVario, showSpeed]);

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

  const focusActiveClimb = React.useCallback(() => {
    if (!activeClimb || !computed?.fixesFull?.length) return;

    const f = computed.fixesFull;
    const sRaw = f[activeClimb.startIdx]?.tSec;
    const eRaw = f[activeClimb.endIdx]?.tSec;
    if (!Number.isFinite(sRaw) || !Number.isFinite(eRaw)) return;

    const cs = Math.min(sRaw as number, eRaw as number);
    const ce = Math.max(sRaw as number, eRaw as number);

    const PAD = 0.75;
    const maxT = chartData?.maxT ?? winTotalSec ?? ce;

    const startValue = clamp(cs - PAD, 0, maxT);
    const endValue = clamp(ce + PAD, 0, maxT);

    applyRangeToCharts(getVisibleCharts(), startValue, endValue);

    setMapFocusKey((x) => x + 1);

    pulse();
  }, [activeClimb, computed?.fixesFull, chartData?.maxT, winTotalSec, getVisibleCharts, pulse]);

  function getVisibleXRange(inst: any, fallbackMaxT: number): { min: number; max: number } {
    try {
      const model = inst.getModel?.();
      const xAxis = model?.getComponent?.("xAxis", 0);
      const scale = xAxis?.axis?.scale;
      const ext = scale?.getExtent?.();
      if (Array.isArray(ext) && ext.length === 2) {
        const min = Number(ext[0]);
        const max = Number(ext[1]);
        if (Number.isFinite(min) && Number.isFinite(max) && max > min) return { min, max };
      }
    } catch { }
    return { min: 0, max: Number.isFinite(fallbackMaxT) ? fallbackMaxT : 0 };
  }

  function applyRangeToCharts(
    charts: Array<{ kind: "alt" | "vario" | "speed"; inst: any }>,
    startValue: number,
    endValue: number
  ) {
    for (const { kind, inst } of charts) {
      const idxs = kind === "alt" ? [0, 1] : [0];
      for (const dataZoomIndex of idxs) {
        inst.dispatchAction?.({ type: "dataZoom", dataZoomIndex, startValue, endValue });
      }
    }
  }

  function clampRange(start: number, end: number, maxT: number) {
    let s = start;
    let e = end;
    if (!Number.isFinite(maxT) || maxT <= 0) return { s, e };

    s = Math.max(0, Math.min(s, maxT));
    e = Math.max(0, Math.min(e, maxT));

    if (e < s) [s, e] = [e, s];

    return { s, e };
  }

  React.useEffect(() => {
    if (!activeClimb) return;
    if (isDragging) return;

    const f = computed?.fixesFull ?? null;
    if (!f) return;

    const sRaw = f[activeClimb.startIdx]?.tSec;
    const eRaw = f[activeClimb.endIdx]?.tSec;
    if (!Number.isFinite(sRaw) || !Number.isFinite(eRaw)) return;

    const cs = Math.min(sRaw as number, eRaw as number);
    const ce = Math.max(sRaw as number, eRaw as number);

    const charts = getVisibleCharts();
    if (!charts.length) return;

    const primary = charts.find((c) => c.kind === "alt") ?? charts[0];
    const maxT = chartData?.maxT ?? winTotalSec ?? ce;

    const { min, max } = getVisibleXRange(primary.inst, maxT);
    const span = max - min;
    if (!(span > 0)) return;

    const PAD = 0.75;
    const needLeft = cs < min + PAD;
    const needRight = ce > max - PAD;

    if (!needLeft && !needRight) return;

    const climbLen = ce - cs;
    const minNeededSpan = climbLen + 2 * PAD;

    let newStart = min;
    let newEnd = max;

    if (minNeededSpan > span) {
      newStart = cs - PAD;
      newEnd = ce + PAD;
    } else {
      const center = (cs + ce) / 2;
      newStart = center - span / 2;
      newEnd = center + span / 2;
    }

    let { s, e } = clampRange(newStart, newEnd, maxT);

    const hitLeftEdge = s <= 0.0001;
    const maxT2 = chartData?.maxT ?? winTotalSec ?? 0;
    const hitRightEdge = maxT2 > 0 && e >= maxT2 - 0.0001;

    if (!hitLeftEdge && !hitRightEdge) {
      const center = (cs + ce) / 2;
      s = center - span / 2;
      e = center + span / 2;
      ({ s, e } = clampRange(s, e, maxT));
    }

    const stillMissing = cs < s + PAD || ce > e - PAD;
    if (stillMissing) {
      s = Math.max(0, cs - PAD);
      e = Math.min(maxT, ce + PAD);
    }

    applyRangeToCharts(charts, s, e);
  }, [activeClimb, computed?.fixesFull, isDragging, getVisibleCharts, chartData?.maxT, winTotalSec]);

  const zoomSyncLockRef = React.useRef(false);

  type ZoomRange =
    | { kind: "value"; startValue: number; endValue: number }
    | { kind: "percent"; start: number; end: number };

  const setPreviewLinesAll = React.useCallback(
    (a: number, b: number) => {
      const x1 = Math.min(a, b);
      const x2 = Math.max(a, b);

      for (const { inst } of getVisibleCharts()) {
        try {
          inst.setOption({ series: [{ id: "__preview", markLine: { data: [{ xAxis: x1 }, { xAxis: x2 }] } }] }, { silent: true });
        } catch { }
      }
    },
    [getVisibleCharts]
  );

  const clearPreviewAll = React.useCallback(() => {
    for (const { inst } of getVisibleCharts()) {
      try {
        inst.setOption({ series: [{ id: "__preview", markLine: { data: [] } }] }, { silent: true });
      } catch { }
    }
  }, [getVisibleCharts]);

  const setPanEnabled = React.useCallback((kind: ChartKind, enabled: boolean) => {
    const inst = kind === "alt" ? altInstRef.current : kind === "vario" ? varioInstRef.current : speedInstRef.current;
    if (!inst) return;

    const dzId = kind === "alt" ? "dz_inside_alt" : kind === "vario" ? "dz_inside_vario" : "dz_inside_speed";

    try {
      inst.setOption({ dataZoom: [{ id: dzId, disabled: !enabled, moveOnMouseMove: enabled }] }, { silent: true });
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

        const maxT = chartData?.maxT ?? winTotalSec ?? 0;

        setWindowThrottled({
          startSec: t,
          endSec: t,
          totalSec: Number.isFinite(maxT) && maxT > 0 ? maxT : t,
        });

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
          const maxT = chartData?.maxT ?? winTotalSec ?? 0;

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

        setPanEnabled(kind, true);

        const maxT = chartData?.maxT ?? winTotalSec ?? 0;

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
    [chartData?.maxT, winTotalSec, setDragging, setPanEnabled, setPreviewLinesAll, clearPreviewAll, setWindow, setWindowThrottled]
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
    };

    const applyZoomRangeToChart = (inst: any, kind: ChartKind, r: ZoomRange) => {
      if (!inst) return;

      const idxs = kind === "alt" ? [0, 1] : [0];

      for (const dataZoomIndex of idxs) {
        if (r.kind === "value") {
          inst.dispatchAction?.({ type: "dataZoom", dataZoomIndex, startValue: r.startValue, endValue: r.endValue });
        } else {
          inst.dispatchAction?.({ type: "dataZoom", dataZoomIndex, start: r.start, end: r.end });
        }
      }
    };

    const visibles = getVisibleCharts();
    if (visibles.length < 2) return;

    const cleanups: Array<() => void> = [];

    for (const { inst } of visibles) {
      const onDataZoom = (e: any) => {
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

  const mapFixesFull = computedWithLite?.fixesFull ?? EMPTY_FIXES;
  const mapFixesLite = computedWithLite?.fixesLite ?? EMPTY_FIXES;
  const mapThermals = thermals ?? EMPTY_THERMALS;

  const [climbListOpen, setClimbListOpen] = React.useState(false);

  const [hoveredClimbIndex, setHoveredClimbIndex] = React.useState<number | null>(null);

  type ClimbSortMode = "normal" | "gainDesc" | "gainAsc";

  const [climbSortMode, setClimbSortMode] = React.useState<ClimbSortMode>("normal");

  const sortedClimbs = React.useMemo(() => {
    if (climbSortMode === "normal") return climbs;

    const copy = [...climbs];

    if (climbSortMode === "gainDesc") {
      copy.sort((a, b) => b.gainM - a.gainM);
    } else if (climbSortMode === "gainAsc") {
      copy.sort((a, b) => a.gainM - b.gainM);
    }

    return copy;
  }, [climbs, climbSortMode]);

  return (
    <Box p="md">
      <Stack gap="sm">
        {/* HEADER */}
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="md" align="center" wrap="nowrap">
            <Button variant="light" onClick={() => window.history.back()}>
              ← Back
            </Button>

            <Group gap="xs" align="center" wrap="nowrap">

              <Button size="xs" variant="light" onClick={() => setClimbListOpen(true)} disabled={!hasClimbs}>
                Climbs
              </Button>
              <Button size="xs" variant="subtle" onClick={prevClimb} disabled={!hasClimbs}>
                ◀
              </Button>

              <Text size="sm" fw={600} style={{ minWidth: 110, textAlign: "center" }}>
                {climbNavActive ? `Climb ${activeClimbIndex! + 1} / ${climbs.length}` : hasClimbs ? `${climbs.length} climbs` : "No climbs"}
              </Text>

              <Button size="xs" variant="subtle" onClick={nextClimb} disabled={!hasClimbs}>
                ▶
              </Button>

              <Button size="xs" variant="subtle" onClick={clearActiveClimb} disabled={!climbNavActive}>
                ✕
              </Button>
            </Group>
          </Group>

          <Group gap="xs" align="center" wrap="nowrap">

            <Group justify="space-between">
              <Button size="xs" variant="light" onClick={resetSelection} disabled={!win}>
                Reset selection
              </Button>

              <Button size="xs" variant="light" onClick={zoomChartsToWindow} disabled={zoomDisabled}>
                Zoom to window
              </Button>
            </Group>
            <Button size="xs" variant={followEnabled ? "filled" : "light"} onClick={() => setFollowEnabled(!followEnabled)}>
              Follow
            </Button>

            <Button size="xs" variant={zoomSyncEnabled ? "filled" : "light"} onClick={() => setZoomSyncEnabled(!zoomSyncEnabled)}>
              Sync Zoom
            </Button>

            <Button size="xs" variant={syncEnabled ? "filled" : "light"} onClick={() => setSyncEnabled(!syncEnabled)}>
              Sync Charts
            </Button>

            <Button size="xs" variant={showStats ? "filled" : "light"} onClick={() => setShowStats(!showStats)}>
              Stats
            </Button>

            <ActionIcon variant="subtle" size="lg" onClick={() => setSettingsOpen(true)} aria-label="Settings">
              <IconSettings size={18} />
            </ActionIcon>
          </Group>
        </Group>

        {/* SETTINGS DRAWER */}
        <Drawer
          opened={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          title="Settings"
          position="right"
          size="sm"
          padding="md"
          withCloseButton
          withinPortal
          zIndex={3000}
          overlayProps={{ opacity: 0.35, blur: 2 }}
        >
          <Paper withBorder p="sm" radius="md">
            <Group justify="space-between" align="center" mb={6}>
              <Text fw={600} size="sm">
                Flight Summary
              </Text>
              <Text size="xs" c="dimmed">
                {id}
              </Text>
            </Group>

            <SimpleGrid cols={2} spacing="xs" verticalSpacing="xs">
              <Box>
                <Text size="xs" c="dimmed">
                  Climbs
                </Text>
                <Text fw={600}>{climbs.length}</Text>
              </Box>

              <Box>
                <Text size="xs" c="dimmed">
                  Thermals
                </Text>
                <Text fw={600}>{thermalCount}</Text>
              </Box>

              <Box>
                <Text size="xs" c="dimmed">
                  Active climb
                </Text>
                <Text fw={600}>
                  {activeClimb && activeClimbGainM != null && activeClimbDurSec != null ? `${fmtSigned(activeClimbGainM, 0)} m · ${fmtTime(activeClimbDurSec)}` : "—"}
                </Text>
              </Box>

              <Box>
                <Text size="xs" c="dimmed">
                  Window
                </Text>
                <Text fw={600}>
                  {fmtTime(Math.min(winStartSec, winEndSec))} → {fmtTime(Math.max(winStartSec, winEndSec))}
                </Text>
              </Box>
            </SimpleGrid>

            <Divider my="sm" />

            <Group justify="space-between">
              <Button size="xs" variant="light" onClick={focusActiveClimb} disabled={!activeClimb || !computed?.fixesFull?.length}>
                Focus active climb
              </Button>

              <Button
                size="xs"
                variant="light"
                onClick={() => {
                  setSettingsOpen(false);
                  pulse();
                }}
              >
                Close
              </Button>
            </Group>
          </Paper>

          <Stack gap="md">
            <Box>
              <Text fw={600} size="sm" mb={6}>
                Charts
              </Text>

              <Chip.Group
                value={climbSortMode}
                onChange={(v) => setClimbSortMode((v ?? "normal") as ClimbSortMode)}
              >
                <Group gap="xs">
                  <Chip value="alt" radius="sm" variant="filled">
                    Alt
                  </Chip>
                  <Chip value="vario" radius="sm" variant="filled">
                    Vario
                  </Chip>
                  <Chip value="speed" radius="sm" variant="filled">
                    Speed
                  </Chip>
                </Group>
              </Chip.Group>

              <Divider my="sm" />

              <Text fw={600} size="sm" mb={6}>
                Overlays
              </Text>

              <Stack gap="xs">
                <Checkbox label="Climb lines" checked={showClimbLinesOnChart} onChange={(e) => setShowClimbLinesOnChart(e.currentTarget.checked)} />

                <Checkbox label="Thermals" checked={showThermalsOnMap} onChange={(e) => setShowThermalsOnMap(e.currentTarget.checked)} />

                <Checkbox label="Auto fit selection" checked={autoFitSelection} onChange={(e) => setAutoFitSelectionUi(e.currentTarget.checked)} />
              </Stack>

              <Divider my="sm" />

              <Text fw={600} size="sm" mb={6}>
                Map
              </Text>
              <Text fw={600} size="sm" mb={6}>
                Map style
              </Text>

              <Chip.Group value={baseMap} onChange={(v) => setBaseMap(v as UiBaseMap)}>
                <Group gap="xs">
                  <Chip value="osm" radius="sm" variant="filled">OSM</Chip>
                  <Chip value="topo" radius="sm" variant="filled">Topo</Chip>
                  <Chip value="esriBalanced" radius="sm" variant="filled">Topo Lite</Chip>
                </Group>
              </Chip.Group>
            </Box>

            <Divider />

            <NumberInput
              label="Vario win (s)"
              value={varioWindowSec}
              onChange={(v) => setVarioWindowSec(typeof v === "number" ? v : Number(v))}
              min={1}
              max={30}
              step={1}
              size="sm"
            />
          </Stack>
        </Drawer>

        <Drawer
          opened={climbListOpen}
          onClose={() => setClimbListOpen(false)}
          title={`Climbs (${climbs.length})`}
          position="right"
          size="sm"
          padding="md"
          withCloseButton
          withinPortal
          zIndex={3100}
          overlayProps={{ opacity: 0.35, blur: 2 }}
        >
          {!hasClimbs ? (
            <Text c="dimmed" size="sm">No climbs detected.</Text>
          ) : (


            <Stack gap="xs">
              <Box>
                <Text fw={600} size="sm" mb={6}>
                  Sort climbs
                </Text>

                <Chip.Group
                  value={climbSortMode}
                  onChange={(v) => setClimbSortMode(v as ClimbSortMode)}
                >
                  <Group gap="xs">
                    <Chip value="normal" radius="sm">Normal</Chip>
                    <Chip value="gainDesc" radius="sm">Gain ↓</Chip>
                    <Chip value="gainAsc" radius="sm">Gain ↑</Chip>
                  </Group>
                </Chip.Group>
              </Box>

              <Divider my="sm" />
              {sortedClimbs.map((c, listIdx) => {
                const f = computed?.fixesFull ?? [];
                const sSec = f[c.startIdx]?.tSec ?? null;
                const eSec = f[c.endIdx]?.tSec ?? null;

                const durSec =
                  typeof sSec === "number" && typeof eSec === "number"
                    ? Math.max(0, eSec - sSec)
                    : null;

                // 🔑 Original-Index finden (weil activeClimbIndex auf climbs basiert)
                const originalIndex = climbs.findIndex(
                  (cl) => cl.startIdx === c.startIdx && cl.endIdx === c.endIdx
                );

                const isActive = originalIndex !== -1 && activeClimbIndex === originalIndex;
                const isHover = originalIndex !== -1 && hoveredClimbIndex === originalIndex;

                return (
                  <Paper
                    key={`${c.startIdx}-${c.endIdx}-${listIdx}`}
                    withBorder
                    p="sm"
                    radius="md"
                    onMouseEnter={() => originalIndex !== -1 && setHoveredClimbIndex(originalIndex)}
                    onMouseLeave={() => setHoveredClimbIndex(null)}
                    style={{
                      cursor: "pointer",
                      borderColor: isActive ? "rgba(255,212,0,0.9)" : isHover ? "rgba(255,212,0,0.45)" : undefined,
                      boxShadow: isActive
                        ? "0 0 0 2px rgba(255,212,0,0.35)"
                        : isHover
                          ? "0 0 0 1px rgba(255,212,0,0.25)"
                          : undefined,
                      background: isHover ? "rgba(255,212,0,0.06)" : undefined,
                      transition: "background 120ms ease, box-shadow 120ms ease, border-color 120ms ease",
                    }}
                    onClick={() => {
                      if (originalIndex !== -1) setActiveClimbIndex(originalIndex);
                      setClimbListOpen(false); // ✅ richtig: Climb Drawer schließen
                    }}
                  >
                    <Group justify="space-between" align="flex-start" wrap="nowrap">
                      <Box>
                        <Text fw={700} size="sm">
                          {/* optional: Original-Nummer anzeigen */}
                          Climb {originalIndex !== -1 ? originalIndex + 1 : listIdx + 1}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {durSec == null ? "—" : fmtTime(durSec)} · {Math.round(c.startAltM)} → {Math.round(c.peakAltM)} m
                        </Text>
                      </Box>

                      <Text fw={700} size="sm">
                        {durSec && durSec > 0 ? `${(c.gainM / durSec).toFixed(2)} m/s` : "—"}
                      </Text>
                    </Group>

                    <Divider my={8} />

                    <SimpleGrid cols={3} spacing="xs" verticalSpacing="xs">
                      <Box>
                        <Text size="xs" c="dimmed">Start</Text>
                        <Text fw={600} size="sm">{Math.round(c.startAltM)} m</Text>
                      </Box>

                      <Box>
                        <Text size="xs" c="dimmed">Gain</Text>
                        <Text fw={700} size="sm" style={{ color: "rgba(255,212,0,1)" }}>
                          {fmtSigned(c.gainM, 0)} m
                        </Text>
                      </Box>

                      <Box>
                        <Text size="xs" c="dimmed">Peak</Text>
                        <Text fw={600} size="sm">{Math.round(c.peakAltM)} m</Text>
                      </Box>
                    </SimpleGrid>

                    <Group justify="flex-end" mt="xs">
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (originalIndex !== -1) setActiveClimbIndex(originalIndex);
                          setClimbListOpen(false);
                          queueMicrotask(() => focusActiveClimb());
                        }}
                      >
                        Focus
                      </Button>
                    </Group>
                  </Paper>
                );
              })}

            </Stack>
          )}
        </Drawer>


        {/* BODY */}
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

              <Box style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
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
                      replaceMerge={["series"]}
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
                      replaceMerge={["series"]}
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
                      replaceMerge={["series"]}
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
              <Box
                style={{
                  flex: 1,
                  minHeight: 0,
                  borderRadius: 12,
                  transition: "box-shadow 180ms ease, transform 180ms ease",
                  boxShadow: pulseActive ? "0 0 0 2px rgba(255, 212, 0, 0.65)" : undefined,
                  transform: pulseActive ? "scale(1.002)" : undefined,
                  overflow: "hidden",
                }}
              >
                <FlightMap
                  fixesFull={mapFixesFull}
                  fixesLite={mapFixesLite}
                  thermals={mapThermals}
                  activeClimb={activeClimb ? { startIdx: activeClimb.startIdx, endIdx: activeClimb.endIdx } : null}
                  watchKey={`${id}-${baseMap}`}
                  focusKey={mapFocusKey}
                />
              </Box>
            </Box>
          </Box>
        )}
      </Stack>
    </Box>
  );
}
