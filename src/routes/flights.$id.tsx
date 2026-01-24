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

/* eslint-disable @typescript-eslint/no-explicit-any */

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
  const windowSize = 5;

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

export default function FlightDetailsRoute() {
  const token = useAuthStore((s) => s.token);
  const { id } = Route.useParams();

  const [flight, setFlight] = React.useState<FlightRecordDetails | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [windowSec] = React.useState(calculationWindow);

  // map options
  const [baseMap, setBaseMap] = React.useState<BaseMap>("topo");

  // split layout
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const draggingRef = React.useRef(false);
  const [splitPct, setSplitPct] = React.useState<number>(60); // charts width in %

  const onDividerPointerDown = React.useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }, []);

  const onDividerPointerMove = React.useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    e.preventDefault();

    const el = containerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = (x / rect.width) * 100;

    setSplitPct(clamp(pct, 40, 75));
  }, []);

  const onDividerPointerUp = React.useCallback(() => {
    draggingRef.current = false;
  }, []);

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

    // Map expects relative seconds
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
      tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
      axisPointer: { snap: true },
    };
  }, []);

  const altOption = React.useMemo(() => {
    if (!chartData) return {};
    return {
      ...baseOption,
      grid: { left: 56, right: 16, top: 24, bottom: 40 },
      xAxis: { type: "value", min: 0, max: chartData.maxT, axisLabel: { formatter: (v: number) => fmtTime(v) } },
      yAxis: { type: "value", name: "m", min: chartData.altMin, max: chartData.altMax, scale: true },
      dataZoom: [{ type: "inside", xAxisIndex: 0 }, { type: "slider", xAxisIndex: 0, height: 20, bottom: 8 }],
      series: [{ name: "Altitude", type: "line", data: chartData.alt, showSymbol: false, lineStyle: { width: 2 }, sampling: "lttb" }],
    };
  }, [chartData, baseOption]);

  const varioOption = React.useMemo(() => {
    if (!chartData) return {};
    return {
      ...baseOption,
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
          sampling: "lttb",
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
      grid: { left: 56, right: 16, top: 24, bottom: 24 },
      xAxis: { type: "value", min: 0, max: chartData.maxT, axisLabel: { formatter: (v: number) => fmtTime(v) } },
      yAxis: { type: "value", name: "km/h", scale: true },
      dataZoom: [{ type: "inside", xAxisIndex: 0 }],
      series: [{ name: "Ground speed", type: "line", data: chartData.hSpeed, showSymbol: false, lineStyle: { width: 2 }, sampling: "lttb" }],
    };
  }, [chartData, baseOption]);

  // IMPORTANT: When layout changes, ECharts might need resize.
  // We keep it cheap: just rely on react reflow + a small timeout.
  const altRef = React.useRef<EChartsReact | null>(null);
  const varioRef = React.useRef<EChartsReact | null>(null);
  const speedRef = React.useRef<EChartsReact | null>(null);

  React.useEffect(() => {
    const alt = altRef.current?.getEchartsInstance?.();
    const vario = varioRef.current?.getEchartsInstance?.();
    const speed = speedRef.current?.getEchartsInstance?.();

    const t = window.setTimeout(() => {
      alt?.resize();
      vario?.resize();
      speed?.resize();
    }, 60);

    return () => window.clearTimeout(t);
  }, [splitPct]);

  return (
    <Box p="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Button variant="light" onClick={() => window.history.back()}>
            Back
          </Button>

          <Checkbox
            label="Topo"
            checked={baseMap === "topo"}
            onChange={(e) => setBaseMap(e.currentTarget.checked ? "topo" : "osm")}
          />
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
              height: "calc(100vh - 180px)", // optional: give map room; adjust/remove as you like
              minHeight: 520,
            }}
          >
            {/* LEFT: Charts */}
            <Box
              style={{
                width: `${splitPct}%`,
                paddingRight: 12,
                minWidth: 320,
                overflow: "auto",
              }}
            >
              <Stack gap="xs">
                <Box>
                  <Text size="sm" fw={600} mb={4}>
                    Altitude
                  </Text>
                  <EChartsReact ref={altRef as any} echarts={echarts} option={altOption} style={{ height: 320, width: "100%" }} notMerge />
                </Box>

                <Box>
                  <Text size="sm" fw={600} mb={4}>
                    Vertical speed (Vario)
                  </Text>
                  <EChartsReact ref={varioRef as any} echarts={echarts} option={varioOption} style={{ height: 220, width: "100%" }} notMerge />
                </Box>

                <Box>
                  <Text size="sm" fw={600} mb={4}>
                    Horizontal speed
                  </Text>
                  <EChartsReact ref={speedRef as any} echarts={echarts} option={speedOption} style={{ height: 220, width: "100%" }} notMerge />
                </Box>
              </Stack>
            </Box>

            {/* MIDDLE: Drag Divider */}
            <Box
              onPointerDown={onDividerPointerDown}
              onPointerMove={onDividerPointerMove}
              onPointerUp={onDividerPointerUp}
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
            <Box
              style={{
                width: `${100 - splitPct}%`,
                minWidth: 280,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
              }}
            >
              <Text size="sm" fw={600} mb={4}>
                Map
              </Text>

              <Box style={{ flex: 1, minHeight: 0 }}>
                <FlightMap
                  fixes={computed.fixes}
                  baseMap={baseMap}
                  watchKey={`${id}-${baseMap}-${splitPct}`}
                />
              </Box>
            </Box>
          </Box>
        )}
      </Stack>
    </Box>
  );
}
