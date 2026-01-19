import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Box,
  Stack,
  Text,
  Title,
  Alert,
  Button,
  Group,
  Checkbox,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import type { EChartsReact as EChartsReactType } from "echarts-for-react";
import EChartsReact from "echarts-for-react";

import type { FlightRecordDetails } from "../features/flights/flights.types";
import { buildFlightSeries, calculationWindow, parseIgcFixes } from "../features/flights/igc/igc.series";
import { useAuthStore } from "../features/auth/store/auth.store";
import { flightApi } from "../features/flights/flights.api";

import * as echarts from "echarts"

export const Route = createFileRoute("/flights/$id")({
  component: FlightDetailsRoute,
});

function fmtTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function FlightDetailsRoute() {
  const token = useAuthStore((s) => s.token);
  const { id } = Route.useParams();

  const [flight, setFlight] = React.useState<FlightRecordDetails | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [windowSec] = React.useState(calculationWindow);

  // ✅ Sync toggle
  const [syncZoom, setSyncZoom] = React.useState(true);

  // ✅ Chart refs
  const altRef = React.useRef<EChartsReactType | null>(null);
  const varioRef = React.useRef<EChartsReactType | null>(null);
  const speedRef = React.useRef<EChartsReactType | null>(null);

  const computed = React.useMemo(() => {
    if (!flight?.igcContent || !flight.flightDate) return null;

    const fixes = parseIgcFixes(flight.igcContent, flight.flightDate);
    const { series, windows } = buildFlightSeries(fixes, windowSec);

    return { fixesCount: fixes.length, series, windows };
  }, [flight?.igcContent, flight?.flightDate, windowSec]);


  const GROUP_ID = "flight-sync"

  React.useEffect(() => {
    const a = altRef.current?.getEchartsInstance()
    const b = varioRef.current?.getEchartsInstance()
    const c = speedRef.current?.getEchartsInstance()
    if (!a || !b || !c) return

    if (syncZoom) {
      a.group = GROUP_ID
      b.group = GROUP_ID
      c.group = GROUP_ID
      echarts.connect(GROUP_ID)
    } else {
      // optional: sauber trennen
      echarts.disconnect(GROUP_ID)
      a.group = undefined as any
      b.group = undefined as any
      c.group = undefined as any
    }
  }, [syncZoom])

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

  // ---- Build chart data (arrays are fastest for ECharts) ----
  const chartData = React.useMemo(() => {
    if (!computed) return null;

    const alt = computed.series.map((p) => [p.tSec, p.altitudeM] as [number, number]);
    const hSpeed = computed.series.map((p) => [p.tSec, p.gSpeedKmh] as [number, number]);
    const vSpeed = computed.windows.map((p) => [p.tSec, p.vSpeedMs] as [number, number]);

    const maxTSeries = computed.series.length ? computed.series[computed.series.length - 1].tSec : 0;
    const maxTWindows = computed.windows.length ? computed.windows[computed.windows.length - 1].tSec : 0;
    const maxT = Math.max(maxTSeries, maxTWindows);

    return { alt, hSpeed, vSpeed, maxT };
  }, [computed]);

  // ---- Options ----
  const altOption = React.useMemo(() => {
    if (!chartData) return {};
    return {
      animation: false,
      grid: { left: 56, right: 16, top: 24, bottom: 40 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        valueFormatter: (v: unknown) => (typeof v === "number" ? v.toFixed(0) : String(v)),
      },
      axisPointer: {
        link: [{ xAxisIndex: "all" }], // wichtig
      },
      xAxis: {
        type: "value",
        min: 0,
        max: chartData.maxT,
        axisLabel: { formatter: (v: number) => fmtTime(v) },
      },
      yAxis: {
        type: "value",
        name: "m",
        axisLabel: { formatter: (v: number) => String(Math.round(v)) },
        scale: true,
      },
      // Zoom only meaningful on first chart; we still define it so we can dispatch actions
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: 0,
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          moveOnMouseWheel: true,
        },
        {
          type: "slider",
          xAxisIndex: 0,
          height: 20,
          bottom: 8,
        },
      ],
      series: [
        {
          name: "Altitude",
          type: "line",
          data: chartData.alt,
          showSymbol: false,
          sampling: "lttb",
          lineStyle: { width: 2 },
        },
      ],
    };
  }, [chartData]);

  const varioOption = React.useMemo(() => {
    if (!chartData) return {};
    return {
      animation: false,
      grid: { left: 56, right: 16, top: 24, bottom: 24 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        valueFormatter: (v: unknown) => (typeof v === "number" ? v.toFixed(2) : String(v)),
      },
      axisPointer: {
        link: [{ xAxisIndex: "all" }], // wichtig
      },
      xAxis: {
        type: "value",
        min: 0,
        max: chartData.maxT,
        axisLabel: { formatter: (v: number) => fmtTime(v) },
      },
      yAxis: {
        type: "value",
        name: "m/s",
        scale: true,
      },
      // If syncZoom is ON: we disable interaction here and let chart 1 drive it.
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: 0,
          zoomOnMouseWheel: !syncZoom,
          moveOnMouseMove: !syncZoom,
          moveOnMouseWheel: !syncZoom,
        },
      ],
      series: [
        {
          name: "Vario",
          type: "bar",
          data: chartData.vSpeed,
          large: true,
          markLine: { data: [{ yAxis: 0 }] },
        },
      ],
    };
  }, [chartData, syncZoom]);

  const speedOption = React.useMemo(() => {
    if (!chartData) return {};
    return {
      animation: false,
      grid: { left: 56, right: 16, top: 24, bottom: 24 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        valueFormatter: (v: unknown) => (typeof v === "number" ? v.toFixed(1) : String(v)),
      },
      axisPointer: {
        link: [{ xAxisIndex: "all" }], // wichtig
      },
      xAxis: {
        type: "value",
        min: 0,
        max: chartData.maxT,
        axisLabel: { formatter: (v: number) => fmtTime(v) },
      },
      yAxis: {
        type: "value",
        name: "km/h",
        scale: true,
      },
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: 0,
          zoomOnMouseWheel: !syncZoom,
          moveOnMouseMove: !syncZoom,
          moveOnMouseWheel: !syncZoom,
        },
      ],
      series: [
        {
          name: "Ground speed",
          type: "line",
          data: chartData.hSpeed,
          showSymbol: false,
          sampling: "lttb",
          lineStyle: { width: 2 },
        },
      ],
    };
  }, [chartData, syncZoom]);

  // ---- Sync zoom: chart 1 drives charts 2 + 3 ----
  const altEvents = React.useMemo(() => {
    return {
      dataZoom: () => {
        if (!syncZoom) return;

        const altChart = altRef.current?.getEchartsInstance();
        const zr = altChart?.getOption()?.dataZoom;
        if (!altChart || !zr || !Array.isArray(zr) || zr.length === 0) return;

        // Prefer slider if present, fallback to inside
        const dz = (zr.find((z: any) => z.type === "slider") ?? zr[0]) as any;

        // ECharts may provide start/end (%) OR startValue/endValue.
        const start = typeof dz.start === "number" ? dz.start : undefined;
        const end = typeof dz.end === "number" ? dz.end : undefined;
        const startValue = typeof dz.startValue === "number" ? dz.startValue : undefined;
        const endValue = typeof dz.endValue === "number" ? dz.endValue : undefined;

        const targets = [varioRef.current, speedRef.current]
          .map((r) => r?.getEchartsInstance())
          .filter(Boolean) as any[];

        for (const ch of targets) {
          if (start != null && end != null) {
            ch.dispatchAction({
              type: "dataZoom",
              start: clamp(start, 0, 100),
              end: clamp(end, 0, 100),
            });
          } else if (startValue != null && endValue != null) {
            ch.dispatchAction({
              type: "dataZoom",
              startValue,
              endValue,
            });
          }
        }
      },
    };
  }, [syncZoom]);

  return (
    <Box p="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={3}>Flight details</Title>
          <Button variant="light" onClick={() => window.history.back()}>
            Back
          </Button>
        </Group>

        {flight?.igcContent && (
          <Text size="xs" c="dimmed">
            IGC length: {flight.igcContent.length}
          </Text>
        )}

        {busy && <Text c="dimmed">Loading...</Text>}

        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
            {error}
          </Alert>
        )}

        {!busy && !error && !flight && <Text c="dimmed">No flight found.</Text>}

        {flight && (
          <>
            <Stack gap={4}>
              <Text size="sm">
                <b>ID:</b> {flight.id} &nbsp; <b>Date:</b> {flight.flightDate ?? "-"}
              </Text>
              <Text size="sm">
                <b>Pilot:</b> {flight.pilotName ?? "-"} &nbsp; <b>Glider:</b> {flight.gliderType ?? "-"}
              </Text>
              <Text size="sm">
                <b>Filename:</b> {flight.originalFilename ?? "-"}
              </Text>
            </Stack>

            {!computed || !chartData ? (
              <Text c="dimmed" size="sm">
                Missing igcContent or flightDate.
              </Text>
            ) : (
              <>
                <Group justify="space-between" align="center">
                  <Text size="sm">
                    <b>Fixes:</b> {computed.fixesCount} &nbsp; <b>Series:</b> {computed.series.length} &nbsp;{" "}
                    <b>Windows:</b> {computed.windows.length} (windowSec={windowSec})
                  </Text>

                  <Checkbox
                    label="Sync zoom (Altitude drives others)"
                    checked={syncZoom}
                    onChange={(e) => setSyncZoom(e.currentTarget.checked)}
                  />
                </Group>

                <Stack gap="xs">
                  <Box>
                    <Text size="sm" fw={600} mb={4}>
                      Altitude
                    </Text>
                    <EChartsReact
                      echarts={echarts}
                      ref={altRef as any}
                      option={altOption}
                      style={{ height: 320, width: "100%" }}
                      onEvents={altEvents}
                      notMerge={true}
                      lazyUpdate={true}
                    />
                  </Box>

                  <Box>
                    <Text size="sm" fw={600} mb={4}>
                      Vertical speed (Vario)
                    </Text>
                    <EChartsReact
                      echarts={echarts}
                      ref={varioRef as any}
                      option={varioOption}
                      style={{ height: 220, width: "100%" }}
                      notMerge={true}
                      lazyUpdate={true}
                    />
                  </Box>

                  <Box>
                    <Text size="sm" fw={600} mb={4}>
                      Horizontal speed
                    </Text>
                    <EChartsReact
                      echarts={echarts}
                      ref={speedRef as any}
                      option={speedOption}
                      style={{ height: 220, width: "100%" }}
                      notMerge={true}
                      lazyUpdate={true}
                    />
                  </Box>
                </Stack>
              </>
            )}
          </>
        )}
      </Stack>
    </Box>
  );
}
