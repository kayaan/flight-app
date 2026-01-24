// flights.$id.tsx
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Box, Stack, Text, Alert, Button, Group, Checkbox } from "@mantine/core";
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

/* eslint-disable @typescript-eslint/no-explicit-any */

interface AxisPointerLabelParams {
  /**
   * Der Wert der Achse an der aktuellen Maus-Position
   */
  value: number | string | Date;

  /**
   * Welche Achse ('x', 'y', manchmal 'z' oder 'angle'/'radius' bei Polar)
   */
  axisDimension: 'x' | 'y' | 'z' | string;

  /**
   * Index der Achse (0, 1, ... bei mehreren x/y-Achsen)
   */
  axisIndex: number;

  /**
   * Die Datenpunkte der Serien an dieser Position (meist 1 pro Serie)
   */
  seriesData: Array<{
    seriesName?: string;
    value: any;                    // number | number[] | ...
    dataIndex?: number;
    axisValue?: string | number;
    axisValueLabel?: string;
    // Füge bei Bedarf mehr Felder hinzu (color, marker, ...)
  }>;

  // Optional: Manchmal noch weitere interne Felder
  [key: string]: any;
}


const axisPointerLabelFormatter = (params: AxisPointerLabelParams) => {
  const v = params.value as any;

  if (params.axisDimension === "x") {
    // v kann number|string|Date sein, aber bei value-axis ist es normalerweise number
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
  // häufig: params.value = [x, y]
  const v = params?.value ?? params?.data?.value ?? params?.data;

  if (Array.isArray(v)) {
    const x = v[0];
    return typeof x === "number" && Number.isFinite(x) ? x : null;
  }

  // falls du irgendwann nur x als number bekommst
  if (typeof v === "number" && Number.isFinite(v)) return v;

  return null;
}

export default function FlightDetailsRoute() {
  const token = useAuthStore((s) => s.token);
  const { id } = Route.useParams();


  const FOLLOW_KEY = "flyapp.flightDetails.followMarker";

  const [followEnabled, setFollowEnabled] = React.useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(FOLLOW_KEY);
      if (raw == null) return true; // default ON
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

  const setHoverTSecThrottled = useFlightHoverStore(s => s.setHoverTSecThrottled);
  const clearNow = useFlightHoverStore(s => s.clearNow);

  const chartEvents = React.useMemo(() => {
    return {
      mousemove: (params: any) => {
        const t = extractTSec(params);
        if (t != null) setHoverTSecThrottled(t);
      },

      // besser, wenn tooltip.trigger = 'axis' genutzt wird
      updateAxisPointer: (e: any) => {
        const ax = e?.axesInfo?.[0];
        const t = ax?.value;
        if (typeof t === "number" && Number.isFinite(t)) setHoverTSecThrottled(t);
      },

      // wenn Maus rausgeht: sofort clear + trailing cancel
      globalout: () => {
        clearNow();
      },
    } as const;
  }, [setHoverTSecThrottled, clearNow]);


  const [flight, setFlight] = React.useState<FlightRecordDetails | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [windowSec] = React.useState(calculationWindow);

  // map options
  const [baseMap, setBaseMap] = React.useState<BaseMap>("topo");

  // charts sync
  const [syncEnabled, setSyncEnabled] = React.useState(true);
  const chartGroupId = React.useMemo(() => `flight-${id}-charts`, [id]);

  // hold actual echarts instances (reliable linking)
  const altInstRef = React.useRef<any>(null);
  const varioInstRef = React.useRef<any>(null);
  const speedInstRef = React.useRef<any>(null);
  const [chartsReadyTick, setChartsReadyTick] = React.useState(0);

  // splitter
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
        axisPointer: { type: "cross" }
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

  // inside component:
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
        axisLabel: { formatter: (v: number) => fmtTime(v) }, // ok, kann so bleiben
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
          name: "Altitude",
          type: "line",
          data: chartData.alt,
          showSymbol: false,
          lineStyle: { width: 2 },
        },
      ],
    };
  }, [chartData, baseOption]);

  const varioOption = React.useMemo(() => {
    if (!chartData) return {};
    return {
      ...baseOption,
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "cross",
          lineStyle: {
            color: 'rgba(255, 77, 79, 0.9)',  // halbtransparentes Rot
            width: 1.5,
            type: 'dashed',
            dashOffset: 0,                    // optional: Versatz der Striche
          },
          label: {
            show: true,
            formatter: (params: AxisPointerLabelParams) => {
              if (params.axisDimension === 'x') {
                const time = params.value as number;
                return time.toFixed(0) + " s";
              }

              if (params.axisDimension === 'y') {
                const vSpeed = params.value as number;
                return vSpeed.toFixed(1) + " m/s";

              }
            }
          }
        },
        formatter: (params: any[]) => {
          const y = params?.[0]?.value?.[1];
          if (y == null) return "";
          return `<strong>${y.toFixed(1)} m/s</strong>`;
        }
      },
      grid: { left: 56, right: 16, top: 24, bottom: 24 },
      xAxis: { type: "value", min: 0, max: chartData.maxT, axisLabel: { formatter: (v: number) => fmtTime(v) } },
      yAxis: { type: "value", name: "m/s", min: chartData.vMin, max: chartData.vMax, scale: true },
      dataZoom: [{ type: "inside", xAxisIndex: 0 }],
      series: [
        {
          name: "Vario",
          type: "line",
          data: chartData.vSpeed,
          showSymbol: false,
          lineStyle: { width: 2 },
          smooth: 0.35,
          smoothMonotone: "x",
          markLine: { symbol: ["none", "none"], lineStyle: { type: "dashed", opacity: 0.6 }, data: [{ yAxis: 0 }] },
        },
      ],
    };
  }, [chartData, baseOption]);

  const speedOption = React.useMemo(() => {
    if (!chartData) return {};
    return {
      ...baseOption,
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "cross",
          lineStyle: {
            color: 'rgba(255, 77, 79, 0.9)',  // halbtransparentes Rot
            width: 1.5,
            type: 'dashed',
            dashOffset: 0,                    // optional: Versatz der Striche
          },
          label: {
            show: true,
            formatter: (params: AxisPointerLabelParams) => {
              if (params.axisDimension === 'x') {
                const time = params.value as number;
                return time.toFixed(0) + " s";
              }

              if (params.axisDimension === 'y') {
                const speed = params.value as number;
                return speed.toFixed(0) + " m/s";

              }
            }
          }
        },
        formatter: (params: any[]) => {
          const y = params?.[0]?.value?.[1];
          if (y == null) return "";
          return `<strong>${y.toFixed(1)} km/h</strong>`;
        }
      },
      grid: { left: 56, right: 16, top: 24, bottom: 24 },
      xAxis: { type: "value", min: 0, max: chartData.maxT, axisLabel: { formatter: (v: number) => fmtTime(v) } },
      yAxis: { type: "value", name: "km/h", scale: true },
      dataZoom: [{ type: "inside", xAxisIndex: 0 }],
      series: [{ name: "Ground speed", type: "line", data: chartData.hSpeed, showSymbol: false, lineStyle: { width: 2 }, }],
    };
  }, [chartData, baseOption]);

  // Connect charts when all are ready
  React.useEffect(() => {
    const a = altInstRef.current;
    const v = varioInstRef.current;
    const s = speedInstRef.current;

    // always clean up old group connections when id/group changes
    echarts.disconnect(chartGroupId);

    if (!syncEnabled) return;
    if (!a || !v || !s) return;

    // ensure same group
    a.group = chartGroupId;
    v.group = chartGroupId;
    s.group = chartGroupId;

    // connect by group id (robust)
    echarts.connect(chartGroupId);

    return () => {
      echarts.disconnect(chartGroupId);
    };
  }, [chartGroupId, syncEnabled, chartsReadyTick]);

  // resize charts when splitter moves
  React.useEffect(() => {
    const t = window.setTimeout(() => {
      altInstRef.current?.resize?.();
      varioInstRef.current?.resize?.();
      speedInstRef.current?.resize?.();
    }, 40);

    return () => window.clearTimeout(t);
  }, [splitPct]);

  return (
    <Box p="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Button variant="light" onClick={() => window.history.back()}>
            Back
          </Button>

          <Group gap="md">
            <Checkbox label="Topo" checked={baseMap === "topo"} onChange={(e) => setBaseMap(e.currentTarget.checked ? "topo" : "osm")} />
            <Checkbox label="Charts sync" checked={syncEnabled} onChange={(e) => setSyncEnabled(e.currentTarget.checked)} />
            <Checkbox
              label="Follow marker"
              checked={followEnabled}
              onChange={(e) => setFollowEnabled(e.currentTarget.checked)}
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
                <FlightMap
                  fixes={computed.fixes}
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
