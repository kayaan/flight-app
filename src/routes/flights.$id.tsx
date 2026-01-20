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
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import type { EChartsReact as EChartsReactType } from "echarts-for-react";
import EChartsReact from "echarts-for-react";

import type { FlightRecordDetails } from "../features/flights/flights.types";
import {
  buildFlightSeries,
  calculationWindow,
  parseIgcFixes,
} from "../features/flights/igc/igc.series";
import { useAuthStore } from "../features/auth/store/auth.store";
import { flightApi } from "../features/flights/flights.api";

import * as echarts from "echarts";
import { FlightMap } from "../features/flights/map/FlightMapBase";
import type { LatLngTuple } from "leaflet";

import { Divider } from "@mantine/core";
import { IconMap, IconX } from "@tabler/icons-react";
/* eslint-disable @typescript-eslint/no-explicit-any */

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
function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function varioColor(v: number) {
  const max = 7;
  const t = clamp01(Math.abs(v) / max); // 0..1

  const hue = v >= 0 ? 120 : 0;         // grün / rot
  const sat = 35 + t * 45;              // 35% -> 80%
  const light = 78 - t * 45;            // 78% -> 33%

  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

function safeClosestIndex(points: [number, number][], x: number) {
  if (!points.length) return 0;
  if (x <= points[0][0]) return 0;
  const last = points.length - 1;
  if (x >= points[last][0]) return last;

  let lo = 0;
  let hi = last;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] < x) lo = mid + 1;
    else hi = mid;
  }

  const i1 = lo;
  const i0 = lo - 1;

  return Math.abs(points[i0][0] - x) <= Math.abs(points[i1][0] - x) ? i0 : i1;
}

function FlightDetailsRoute() {
  const token = useAuthStore((s) => s.token);
  const { id } = Route.useParams();

  const [flight, setFlight] = React.useState<FlightRecordDetails | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [windowSec] = React.useState(calculationWindow);

  // ✅ Sync toggle (Zoom + Tooltip sync)
  const [syncZoom, setSyncZoom] = React.useState(true);

  // ✅ Chart refs
  const altRef = React.useRef<EChartsReactType | null>(null);
  const varioRef = React.useRef<EChartsReactType | null>(null);
  const speedRef = React.useRef<EChartsReactType | null>(null);

  // ✅ Prevent recursion / event loops
  const syncingRef = React.useRef(false);


  const [mapOpen, setMapOpen] = React.useState(false);

  // Anteil links (Charts) in %, nur relevant wenn mapOpen=true
  const [splitPct, setSplitPct] = React.useState(60);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const draggingRef = React.useRef(false);

  function clamp(n: number, min: number, max: number) {
    return Math.min(max, Math.max(min, n));
  }

  const onDividerPointerDown = React.useCallback((e: React.PointerEvent) => {
    if (!mapOpen) return;
    draggingRef.current = true;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }, [mapOpen]);

  const onDividerPointerMove = React.useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const el = containerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = (x / rect.width) * 100;

    // Grenzen: Charts min 40%, Map min 25%
    setSplitPct(clamp(pct, 40, 75));
  }, []);

  const onDividerPointerUp = React.useCallback(() => {
    draggingRef.current = false;
  }, []);

  function sampleEveryNth<T>(arr: T[], n: number): T[] {
    if (n <= 1) return arr;
    const out: T[] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr[i]);
    return out;
  }

  const computed = React.useMemo(() => {
    if (!flight?.igcContent || !flight.flightDate) return null;

    const fixes = parseIgcFixes(flight.igcContent, flight.flightDate);
    const { series, windows } = buildFlightSeries(fixes, windowSec);

    // Leaflet points: [lat, lon]
    const rawPoints: LatLngTuple[] = fixes.map((f) => [f.lat, f.lon]);

    // Performance: n=1 (kein sampling) oder z.B. 3/5/10
    const mapPoints = sampleEveryNth(rawPoints, 3);

    return { fixesCount: fixes.length, series, windows, mapPoints };
  }, [flight?.igcContent, flight?.flightDate, windowSec]);

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


  React.useEffect(() => {
    const alt = altRef.current?.getEchartsInstance?.();
    const vario = varioRef.current?.getEchartsInstance?.();
    const speed = speedRef.current?.getEchartsInstance?.();

    // kleiner delay, damit Layout fertig ist
    const t = window.setTimeout(() => {
      alt?.resize();
      vario?.resize();
      speed?.resize();
    }, 50);

    return () => window.clearTimeout(t);
  }, [mapOpen, splitPct]);

  // ---- Build chart data (arrays are fastest for ECharts) ----
  const chartData = React.useMemo(() => {
    if (!computed) return null;

    const alt = computed.series.map((p) => [p.tSec, p.altitudeM] as [number, number]);
    const hSpeed = computed.series.map((p) => [p.tSec, p.gSpeedKmh] as [number, number]);

    const vSpeed = computed.windows.map((p) => [p.tSec, p.vSpeedMs] as [number, number]);
    const vUp = computed.windows.map((p) => [p.tSec, p.vSpeedMs >= 0 ? p.vSpeedMs : null] as [number, number | null]);
    const vDown = computed.windows.map((p) => [p.tSec, p.vSpeedMs < 0 ? p.vSpeedMs : null] as [number, number | null]);

    const maxTSeries = computed.series.length ? computed.series[computed.series.length - 1].tSec : 0;
    const maxTWindows = computed.windows.length ? computed.windows[computed.windows.length - 1].tSec : 0;
    const maxT = Math.max(maxTSeries, maxTWindows);

    return { alt, hSpeed, vSpeed, vUp, vDown, maxT };
  }, [computed]);


  const timeMarker = `<span style="
            display:inline-block;
            margin-right:6px;
            border-radius:50%;
            width:10px;
            height:10px;
            background-color:#999;
          "></span>`;

  // ---- Options ----
  const altOption = React.useMemo(() => {
    if (!chartData) return {};
    return {
      animation: false,
      grid: { left: 56, right: 16, top: 24, bottom: 40 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        valueFormatter: (v: unknown) =>
          typeof v === "number" ? v.toFixed(0) : String(v),
        formatter: (params: any) => {
          const list = Array.isArray(params) ? params : [params];
          const p0 = list[0];

          // X: Sekunden als ganze Zahl
          const xSec = Math.round(Number(p0?.value?.[0] ?? p0?.axisValue ?? 0));

          // Y: zuerst der Wert (deine Serie ist [x,y])
          const lines = list.map((p: any) => {
            const y = Number(p?.value?.[1] ?? p?.data?.[1] ?? p?.value ?? 0);
            return `${p.marker ?? ""}${p.seriesName}: ${Math.round(y)}`;
          });

          // erst Werte, dann X
          return `${lines.join("<br/>")}<br/>${timeMarker}t: ${xSec}s`;
        },
      },
      axisPointer: { snap: true },
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
  }, [chartData, timeMarker]);

  const varioOption = React.useMemo(() => {
    if (!chartData) return {};
    return {

      animation: false,
      grid: { left: 56, right: 16, top: 24, bottom: 24 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        valueFormatter: (v: unknown) => (typeof v === "number" ? v.toFixed(2) : String(v)),

        // ✅ WICHTIG: Tooltip NICHT an Maus koppeln (sonst hide bei mouseout)
        triggerOn: "none",

        // ✅ WICHTIG: Tooltip bleibt stehen, bis wir ihn selbst hideTippen
        alwaysShowContent: true,
        formatter: (params: any) => {
          const list = Array.isArray(params) ? params : [params];
          const p0 = list[0];

          // X: Sekunden als ganze Zahl
          const xSec = Math.round(Number(p0?.value?.[0] ?? p0?.axisValue ?? 0));

          // Y: zuerst der Wert (deine Serie ist [x,y])
          const lines = list.map((p: any) => {
            const y = Number(p?.value?.[1] ?? p?.data?.[1] ?? p?.value ?? 0);
            return `${p.marker ?? ""}${p.seriesName}: ${y.toFixed(2)}`;  // ✅ 3) HIER
          });

          // erst Werte, dann X
          return `${lines.join("<br/>")}<br/>${timeMarker}${xSec}s`;
        },
      },
      axisPointer: { snap: true },
      xAxis: {
        type: "value",
        min: 0,
        max: chartData.maxT,
        axisLabel: { formatter: (v: number) => fmtTime(v) },
        axisPointer: { show: true },
      },
      yAxis: {
        type: "value",
        name: "m/s",
        scale: true,
      },
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: 0,
          // Wenn sync an: Interaktion hier aus, Alt treibt Zoom
          zoomOnMouseWheel: !syncZoom,
          moveOnMouseMove: !syncZoom,
          moveOnMouseWheel: !syncZoom,
        },
      ],
      series: [
        {
          name: "Vario up",
          type: "bar",
          data: chartData.vUp,
          large: false,        // ✅ 1) HIER
          progressive: 0,     // ✅ 1) HIER
          markLine: {
            symbol: ["none", "none"],
            lineStyle: { type: "dashed", opacity: 0.6 },
            data: [{ yAxis: 0 }],
          },
          itemStyle: {
            color: (p: any) => {
              const y = p.value?.[1];
              if (y == null) return "rgba(0,0,0,0)";
              return varioColor(y);
            },
          },
        },
        {
          name: "Vario down",
          type: "bar",
          data: chartData.vDown,
          large: false,       // ✅ 1) HIER
          progressive: 0,    // ✅ 1) HIER
          itemStyle: {
            color: (p: any) => {
              const y = p.value?.[1];
              if (y == null) return "rgba(0,0,0,0)";
              return varioColor(y);
            },
          },
        },
      ],
      markLine: {
        symbol: ["none", "none"],
        lineStyle: { type: "dashed", opacity: 0.6 },
        data: [{ yAxis: 0 }],
      },
    };
  }, [chartData, syncZoom, timeMarker]);

  const speedOption = React.useMemo(() => {
    if (!chartData) return {};
    return {
      animation: false,
      grid: { left: 56, right: 16, top: 24, bottom: 24 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        valueFormatter: (v: unknown) => (typeof v === "number" ? v.toFixed(2) : String(v)),

        // ✅ WICHTIG: Tooltip NICHT an Maus koppeln (sonst hide bei mouseout)
        triggerOn: "none",

        // ✅ WICHTIG: Tooltip bleibt stehen, bis wir ihn selbst hideTippen
        alwaysShowContent: true,

        formatter: (params: any) => {
          const list = Array.isArray(params) ? params : [params];
          const p0 = list[0];

          // X: Sekunden als ganze Zahl
          const xSec = Math.round(Number(p0?.value?.[0] ?? p0?.axisValue ?? 0));

          // Y: zuerst der Wert (deine Serie ist [x,y])
          const lines = list.map((p: any) => {
            const y = Number(p?.value?.[1] ?? p?.data?.[1] ?? p?.value ?? 0);
            return `${p.marker ?? ""}${p.seriesName}: ${y.toFixed(1)}`; // speed: 1 Nachkommastelle
          });

          // erst Werte, dann X
          return `${lines.join("<br/>")}<br/>${timeMarker}${xSec}s`;
        },

      },
      axisPointer: { snap: true },
      xAxis: {
        type: "value",
        min: 0,
        max: chartData.maxT,
        axisLabel: { formatter: (v: number) => fmtTime(v) },
        axisPointer: { show: true },
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
          lineStyle: { width: 2 },
        },
      ],
    };
  }, [chartData, syncZoom, timeMarker]);

  // ---- Altitude events drive (a) Zoom sync, (b) Tooltip sync ----
  const altEvents = React.useMemo(() => {
    return {
      dataZoom: () => {
        if (!syncZoom) return;
        if (syncingRef.current) return;

        const alt = altRef.current?.getEchartsInstance?.();
        const vario = varioRef.current?.getEchartsInstance?.();
        const speed = speedRef.current?.getEchartsInstance?.();
        if (!alt || !vario || !speed) return;

        const dzs = alt.getOption()?.dataZoom as any[] | undefined;
        if (!dzs?.length) return;

        // ✅ Slider bevorzugen (weil der verlässlich den Zustand hält)
        const dz =
          dzs.find((z) => z.type === "slider") ??
          dzs.find((z) => z.type === "inside") ??
          dzs[0];

        if (!dz) return;

        try {
          syncingRef.current = true;

          if (typeof dz.start === "number" && typeof dz.end === "number") {
            for (const ch of [vario, speed]) {
              ch.dispatchAction({
                type: "dataZoom",
                xAxisIndex: 0,
                start: dz.start,
                end: dz.end,
              });
            }
          } else if (
            typeof dz.startValue === "number" &&
            typeof dz.endValue === "number"
          ) {
            for (const ch of [vario, speed]) {
              ch.dispatchAction({
                type: "dataZoom",
                xAxisIndex: 0,
                startValue: dz.startValue,
                endValue: dz.endValue,
              });
            }
          }
        } finally {
          syncingRef.current = false;
        }
      },

      updateAxisPointer: (e: any) => {
        if (!syncZoom) return;
        if (!chartData) return;
        if (syncingRef.current) return;

        const x = e?.axesInfo?.[0]?.value;
        if (typeof x !== "number") return;

        const alt = altRef.current?.getEchartsInstance?.();
        const vario = varioRef.current?.getEchartsInstance?.();
        const speed = speedRef.current?.getEchartsInstance?.();
        if (!alt || !vario || !speed) return;

        const iAlt = safeClosestIndex(chartData.alt, x);
        const iSpeed = iAlt;

        // ✅ Index im windows-array bestimmen
        const iV = safeClosestIndex(chartData.vSpeed, x);
        const vAt = chartData.vSpeed[iV]?.[1] ?? 0;

        // ✅ up/down seriesIndex bestimmen
        const varioSeriesIndex = vAt >= 0 ? 0 : 1;

        try {
          syncingRef.current = true;

          alt.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: iAlt });

          // ✅ vario showTip auf die richtige Serie
          vario.dispatchAction({
            type: "showTip",
            xAxisIndex: 0,
            xAxisValue: x,
            seriesIndex: varioSeriesIndex,
            dataIndex: iV,
          });

          speed.dispatchAction({
            type: "showTip",
            xAxisIndex: 0,
            xAxisValue: x,
            seriesIndex: 0,
            dataIndex: iSpeed,
          });

          // ✅ AxisPointer Linie sichtbar halten
          vario.dispatchAction({ type: "updateAxisPointer", xAxisIndex: 0, value: x });
          speed.dispatchAction({ type: "updateAxisPointer", xAxisIndex: 0, value: x });
        } finally {
          syncingRef.current = false;
        }
      },


      globalout: () => {
        if (!syncZoom) return;
        for (const ch of [
          altRef.current?.getEchartsInstance?.(),
          varioRef.current?.getEchartsInstance?.(),
          speedRef.current?.getEchartsInstance?.(),
        ].filter(Boolean) as any[]) {
          ch.dispatchAction({ type: "hideTip" });
        }
      },
    };
  }, [syncZoom, chartData]);

  return (
    <Box p="md">
      <Stack gap="sm">
        <Group gap="xs">
          <Button variant="light" onClick={() => window.history.back()}>
            Back
          </Button>

          {!mapOpen ? (
            <Button
              leftSection={<IconMap size={16} />}
              variant="light"
              onClick={() => setMapOpen(true)}
              disabled={!computed?.mapPoints?.length}
            >
              Map open
            </Button>
          ) : (
            <Button
              leftSection={<IconX size={16} />}
              variant="light"
              onClick={() => setMapOpen(false)}
            >
              Map close
            </Button>
          )}
        </Group>



        {busy && <Text c="dimmed">Loading...</Text>}

        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
            {error}
          </Alert>
        )}

        {!busy && !error && !flight && <Text c="dimmed">No flight found.</Text>}

        {flight && (
          <>


            {!computed || !chartData ? (
              <Text c="dimmed" size="sm">
                Missing igcContent or flightDate.
              </Text>
            ) : (
              <>
                <Group justify="space-between" align="center">
                  <Text size="sm">
                    <b>Fixes:</b> {computed.fixesCount} &nbsp; <b>Series:</b>{" "}
                    {computed.series.length} &nbsp; <b>Windows:</b>{" "}
                    {computed.windows.length} (windowSec={windowSec})
                  </Text>

                  <Checkbox
                    label="Sync zoom (Altitude drives others)"
                    checked={syncZoom}
                    onChange={(e) => setSyncZoom(e.currentTarget.checked)}
                  />
                </Group>
                <Box
                  ref={containerRef}
                  style={{
                    display: "flex",
                    gap: 0,
                    alignItems: "stretch",
                    width: "100%",
                    minHeight: 320,
                  }}
                >
                  {/* LEFT: Charts */}
                  <Box
                    style={{
                      width: mapOpen ? `${splitPct}%` : "100%",
                      paddingRight: mapOpen ? 12 : 0,
                      transition: "width 120ms ease",
                    }}
                  >
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
                          notMerge
                          lazyUpdate
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
                          notMerge
                          lazyUpdate
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
                          notMerge
                          lazyUpdate
                        />
                      </Box>
                    </Stack>
                  </Box>

                  {/* MIDDLE: Splitter (nur wenn Map offen) */}
                  {mapOpen && (
                    <Divider
                      orientation="vertical"
                      onPointerDown={onDividerPointerDown}
                      onPointerMove={onDividerPointerMove}
                      onPointerUp={onDividerPointerUp}
                      style={{
                        cursor: "col-resize",
                        userSelect: "none",
                        touchAction: "none",
                        width: 10,               // dick genug zum greifen
                        marginRight: 12,
                      }}
                    />
                  )}

                  {/* RIGHT: Map (nur wenn offen) */}
                  {mapOpen && (
                    <Box
                      style={{
                        width: `${100 - splitPct}%`,
                        minWidth: 260,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "stretch",
                      }}
                    >
                      <Text size="sm" fw={600} mb={4}>
                        Map
                      </Text>

                      {/* Leaflet braucht echte Höhe -> Map nimmt den Rest */}
                      <Box style={{ flex: 1, minHeight: 0 }}>
                        <FlightMap points={computed?.mapPoints ?? []} />
                      </Box>
                    </Box>
                  )}
                </Box>


              </>
            )}
          </>
        )}
      </Stack>
    </Box>
  );
}
