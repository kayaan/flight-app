// flights.$id.tsx
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Box, Stack, Text, Alert, Button, Group, Checkbox, SimpleGrid, Paper } from "@mantine/core";
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

function calculateVSpeedFromSeries(points: SeriesPoint[]): [number, number][] {
  const result: [number, number][] = [];
  const windowSize = 10;

  for (let i = 0; i < points.length; i += windowSize) {
    const chunk = points.slice(i, i + windowSize);

    let vSpeed = 0;
    if (chunk.length > 1) {
      const a = chunk[0];
      const b = chunk[chunk.length - 1];
      const dt = b.tSec - a.tSec;
      if (dt !== 0) vSpeed = (b.altitudeM - a.altitudeM) / dt;
    }

    const rounded = Math.round(vSpeed * 100) / 100;
    for (const p of chunk) result.push([p.tSec, rounded]);
  }

  return result;
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

function computeSegmentStats(series: SeriesPoint[], startSec: number, endSec: number): SegmentStats {
  const s = Math.max(0, Math.min(startSec, endSec));
  const e = Math.max(0, Math.max(startSec, endSec));
  const durSec = Math.max(0, e - s);

  if (!series.length || durSec <= 0) {
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

  if (i1 <= i0) {
    const p = series[i0];
    return {
      hasSegment: true,
      durSec,
      altStart: p.altitudeM,
      altEnd: p.altitudeM,
      dAlt: 0,
      altMin: p.altitudeM,
      altMax: p.altitudeM,
      vAvg: 0,
      vMax: 0,
      vMin: 0,
      speedAvgKmh: p.gSpeedKmh ?? null,
      speedMaxKmh: p.gSpeedKmh ?? null,
      pctClimb: 0,
      pctSink: 0,
      pctGlide: 100,
      longestClimbDurSec: 0,
      longestClimbDAlt: 0,
    };
  }

  const altStart = series[i0].altitudeM;
  const altEnd = series[i1].altitudeM;

  let altMin = Number.POSITIVE_INFINITY;
  let altMax = Number.NEGATIVE_INFINITY;

  let vSum = 0;
  let vDtSum = 0;
  let vMax = Number.NEGATIVE_INFINITY;
  let vMin = Number.POSITIVE_INFINITY;

  let speedSum = 0;
  let speedDtSum = 0;
  let speedMax = Number.NEGATIVE_INFINITY;

  // Phase-Analyse
  const CLIMB_TH = 0.5; // m/s
  const SINK_TH = -0.7; // m/s

  let climbTime = 0;
  let sinkTime = 0;
  let glideTime = 0;

  // Longest climb block
  let curClimbT = 0;
  let curClimbStartAlt: number | null = null;
  let bestClimbT = 0;
  let bestClimbDAlt = 0;

  for (let i = i0; i < i1; i++) {
    const a = series[i];
    const b = series[i + 1];

    const tA = a.tSec;
    const tB = b.tSec;

    const segStart = Math.max(tA, s);
    const segEnd = Math.min(tB, e);
    const dt = segEnd - segStart;
    if (dt <= 0) continue;

    // min/max altitude (über Punkte im Segment)
    altMin = Math.min(altMin, a.altitudeM, b.altitudeM);
    altMax = Math.max(altMax, a.altitudeM, b.altitudeM);

    // vario über (a->b)
    const denom = tB - tA;
    const v = denom > 0 ? (b.altitudeM - a.altitudeM) / denom : 0;

    vSum += v * dt;
    vDtSum += dt;
    vMax = Math.max(vMax, v);
    vMin = Math.min(vMin, v);

    // speed über a (gewichtete Mittelung)
    const sp = typeof a.gSpeedKmh === "number" && Number.isFinite(a.gSpeedKmh) ? a.gSpeedKmh : NaN;
    if (Number.isFinite(sp)) {
      speedSum += sp * dt;
      speedDtSum += dt;
      speedMax = Math.max(speedMax, sp);
    }

    // phase time
    if (v > CLIMB_TH) climbTime += dt;
    else if (v < SINK_TH) sinkTime += dt;
    else glideTime += dt;

    // longest climb block (konsekutiv)
    if (v > CLIMB_TH) {
      if (curClimbStartAlt == null) curClimbStartAlt = a.altitudeM;
      curClimbT += dt;
    } else {
      if (curClimbT > bestClimbT) {
        bestClimbT = curClimbT;
        const dAlt = curClimbStartAlt == null ? 0 : (a.altitudeM - curClimbStartAlt);
        bestClimbDAlt = dAlt;
      }
      curClimbT = 0;
      curClimbStartAlt = null;
    }
  }

  // finalize last block
  if (curClimbT > bestClimbT) {
    bestClimbT = curClimbT;
    const endAlt = series[i1].altitudeM;
    const dAlt = curClimbStartAlt == null ? 0 : (endAlt - curClimbStartAlt);
    bestClimbDAlt = dAlt;
  }

  const vAvg = vDtSum > 0 ? vSum / vDtSum : null;
  const speedAvg = speedDtSum > 0 ? speedSum / speedDtSum : null;

  const totalPhase = climbTime + sinkTime + glideTime;
  const pctClimb = totalPhase > 0 ? (climbTime / totalPhase) * 100 : null;
  const pctSink = totalPhase > 0 ? (sinkTime / totalPhase) * 100 : null;
  const pctGlide = totalPhase > 0 ? (glideTime / totalPhase) * 100 : null;

  return {
    hasSegment: true,
    durSec,

    altStart,
    altEnd,
    dAlt: altEnd - altStart,
    altMin: Number.isFinite(altMin) ? altMin : null,
    altMax: Number.isFinite(altMax) ? altMax : null,

    vAvg: vAvg != null ? vAvg : null,
    vMax: Number.isFinite(vMax) ? vMax : null,
    vMin: Number.isFinite(vMin) ? vMin : null,

    speedAvgKmh: speedAvg != null ? speedAvg : null,
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
    const vSpeed = calculateVSpeedFromSeries(computed.series);

    const maxT = computed.series.length ? computed.series[computed.series.length - 1].tSec : 0;

    const altValues = alt.map((p) => p[1]);
    const altMin = Math.min(...altValues);
    const altMax = Math.max(...altValues);

    const vVals = vSpeed.map((p) => p[1]);
    const vAbsMax = Math.max(1, ...vVals.map((v) => Math.abs(v)));
    const vMax = Math.ceil(vAbsMax * 1.1 * 2) / 2;
    const vMin = -vMax;

    return { alt, hSpeed, vSpeed, maxT, altMin, altMax, vMin, vMax };
  }, [computed]);

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
    if (!computed?.series) return null;
    return computeSegmentStats(computed.series, startSec, endSec);
  }, [computed?.series, startSec, endSec]);

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
          return `<strong>${y.toFixed(1)} m/s</strong>`;
        },
      },
      grid: { left: 56, right: 16, top: 24, bottom: 24 },
      xAxis: { type: "value", min: 0, max: chartData.maxT, axisLabel: { formatter: (v: number) => fmtTime(v) } },
      yAxis: { type: "value", name: "m/s", min: chartData.vMin, max: chartData.vMax, scale: true },
      dataZoom: INSIDE_ZOOM,
      series: [
        {
          id: "vario",
          name: "Vario",
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
  }, [chartData, baseOption, windowMarkLine]);

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
          return `<strong>${y.toFixed(1)} km/h</strong>`;
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
            <Text size="xs" c="dimmed">Ø Vario</Text>
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
  }, [showStats, segmentStats, startSec, endSec, totalSec]);

  return (
    <Box p="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Button variant="light" onClick={() => window.history.back()}>
            Back
          </Button>

          <Group gap="md">
            <Checkbox
              label="Topo"
              checked={baseMap === "topo"}
              onChange={(e) => setBaseMap(e.currentTarget.checked ? "topo" : "osm")}
            />
            <Checkbox label="Charts sync" checked={syncEnabled} onChange={(e) => setSyncEnabled(e.currentTarget.checked)} />
            <Checkbox label="Follow marker" checked={followEnabled} onChange={(e) => setFollowEnabled(e.currentTarget.checked)} />
            <Checkbox label="Show stats" checked={showStats} onChange={(e) => setShowStats(e.currentTarget.checked)} />
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
