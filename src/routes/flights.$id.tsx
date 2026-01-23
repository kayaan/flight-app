// flights.$id.tsx
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Box, Stack, Text, Alert, Button, Group, Checkbox } from "@mantine/core";
import { IconAlertCircle, IconMap, IconX } from "@tabler/icons-react";
import EChartsReact from "echarts-for-react";
import * as echarts from "echarts";

import type { FlightRecordDetails } from "../features/flights/flights.types";
import { buildFlightSeries, calculationWindow, parseIgcFixes } from "../features/flights/igc/igc.series";
import { useAuthStore } from "../features/auth/store/auth.store";
import { flightApi } from "../features/flights/flights.api";

import { FlightMap, type FlightMapHandle, type FixPoint } from "../features/flights/map/FlightMapBase";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const Route = createFileRoute("/flights/$id")({
  component: FlightDetailsRoute,
});

const LS_KEY = "flyapp.flightDetails.layout.v1";

type LayoutPrefs = {
  mapOpen: boolean;
  splitPct: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function loadLayoutPrefs(): LayoutPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { mapOpen: false, splitPct: 60 };

    const parsed = JSON.parse(raw) as Partial<LayoutPrefs>;
    const mapOpen = Boolean(parsed.mapOpen);
    const splitPct = clamp(Number(parsed.splitPct ?? 60), 40, 75);

    return { mapOpen, splitPct };
  } catch {
    return { mapOpen: false, splitPct: 60 };
  }
}

function saveLayoutPrefs(p: LayoutPrefs) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}

function fmtTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${mm}:${String(ss).padStart(2, "0")}`;
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

  const [baseMap, setBaseMap] = React.useState<"osm" | "topo">("topo");

  const [flight, setFlight] = React.useState<FlightRecordDetails | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [windowSec] = React.useState(calculationWindow);

  const [syncZoom, setSyncZoom] = React.useState(true);
  const [rangePct, setRangePct] = React.useState<[number, number]>([0, 100]);

  const altRef = React.useRef<EChartsReact | null>(null);
  const varioRef = React.useRef<EChartsReact | null>(null);
  const speedRef = React.useRef<EChartsReact | null>(null);

  const syncingRef = React.useRef(false);

  const mapRef = React.useRef<FlightMapHandle | null>(null);

  const hoverRafRef = React.useRef<number | null>(null);
  const pendingHoverSecRef = React.useRef<number | null>(null);

  const [mapOpen, setMapOpen] = React.useState<boolean>(() => loadLayoutPrefs().mapOpen);
  const [splitPct, setSplitPct] = React.useState<number>(() => loadLayoutPrefs().splitPct);

  React.useEffect(() => {
    saveLayoutPrefs({ mapOpen, splitPct });
  }, [mapOpen, splitPct]);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const draggingRef = React.useRef(false);

  const setRangePctSafe = React.useCallback((r: [number, number]) => {
    let a = Math.max(0, Math.min(100, r[0]));
    let b = Math.max(0, Math.min(100, r[1]));
    if (a > b) [a, b] = [b, a];
    if (b - a < 1) b = Math.min(100, a + 1);
    setRangePct([a, b]);
  }, []);

  const onDividerPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      if (!mapOpen) return;
      e.preventDefault();
      draggingRef.current = true;
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    },
    [mapOpen]
  );

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

  // ✅ parse once
  const fixesFull = React.useMemo(() => {
    if (!flight?.igcContent || !flight.flightDate) return null;
    return parseIgcFixes(flight.igcContent, flight.flightDate);
  }, [flight]);

  // ✅ computed for charts + map
  const computed = React.useMemo(() => {
    if (!fixesFull) return null;

    const { series, windows } = buildFlightSeries(fixesFull, windowSec);

    const t0 = fixesFull[0]?.tSec ?? 0;
    const fixes: FixPoint[] = fixesFull.map((f) => ({
      tSec: f.tSec - t0,
      lat: f.lat,
      lon: f.lon,
      altitudeM: f.altitudeM,
    }));

    return { fixesCount: fixesFull.length, series, windows, fixes };
  }, [fixesFull, windowSec]);

  const [zoomPct, setZoomPct] = React.useState<[number, number]>([0, 100]);

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
  }, [mapOpen, splitPct]);

  // ✅ CHANGED: vario uses SAME point count as altitude (line chart)
  const chartData = React.useMemo(() => {
    if (!computed) return null;

    const alt = computed.series.map((p) => [p.tSec, p.altitudeM] as [number, number]);
    const hSpeed = computed.series.map((p) => [p.tSec, p.gSpeedKmh] as [number, number]);

    // vSpeed derived from altitude slope per sample -> same length as alt/hSpeed
    const vSpeed = computed.series.map((p, i) => {
      if (i === 0) return [p.tSec, 0] as [number, number];
      const prev = computed.series[i - 1];
      const dt = Math.max(1, p.tSec - prev.tSec); // avoid div by 0
      const vs = (p.altitudeM - prev.altitudeM) / dt; // m/s
      return [p.tSec, vs] as [number, number];
    });

    const maxT = computed.series.length ? computed.series[computed.series.length - 1].tSec : 0;

    const altValues = alt.map((p) => p[1]);
    const altMin = Math.min(...altValues);
    const altMax = Math.max(...altValues);

    // nice-ish bounds for vario
    const vVals = vSpeed.map((p) => p[1]);
    const vAbsMax = Math.max(1, ...vVals.map((v) => Math.abs(v)));
    const vMax = Math.ceil(vAbsMax * 1.05 * 2) / 2; // round to 0.5
    const vMin = -vMax;

    return { alt, hSpeed, vSpeed, maxT, altMin, altMax, vMin, vMax };
  }, [computed]);

  const timeMarker = `<span style="
    display:inline-block;
    margin-right:6px;
    border-radius:50%;
    width:10px;
    height:10px;
    background-color:#999;
  "></span>`;

  const altOption = React.useMemo(() => {
    if (!chartData) return {};

    const [winStartPct, winEndPct] = rangePct;
    const winStartSec = (chartData.maxT * winStartPct) / 100;
    const winEndSec = (chartData.maxT * winEndPct) / 100;

    return {
      animation: false,
      grid: { left: 56, right: 16, top: 24, bottom: 40 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        valueFormatter: (v: unknown) => (typeof v === "number" ? v.toFixed(0) : String(v)),
        formatter: (params: any) => {
          const list = Array.isArray(params) ? params : [params];
          const p0 = list[0];
          const xSec = Math.round(Number(p0?.value?.[0] ?? p0?.axisValue ?? 0));

          const lines = list.map((p: any) => {
            const y = Number(p?.value?.[1] ?? p?.data?.[1] ?? p?.value ?? 0);
            return `${p.marker ?? ""}${p.seriesName}: ${Math.round(y)}`;
          });

          return `${lines.join("<br/>")}<br/>${timeMarker}t: ${xSec}s`;
        },
      },
      axisPointer: { snap: true },
      xAxis: { type: "value", min: 0, max: chartData.maxT, axisLabel: { formatter: (v: number) => fmtTime(v) } },
      yAxis: { type: "value", name: "m", min: chartData.altMin, max: chartData.altMax, axisLabel: { formatter: (v: number) => String(Math.round(v)) }, scale: true },
      dataZoom: [
        { type: "inside", xAxisIndex: 0 },
        { type: "slider", xAxisIndex: 0, start: zoomPct[0], end: zoomPct[1], height: 20, bottom: 8 },
      ],
      series: [
        {
          name: "Altitude",
          type: "line",
          data: chartData.alt,
          showSymbol: false,
          sampling: "lttb",
          lineStyle: { width: 2 },
          markArea: { silent: true, itemStyle: { color: "rgba(59, 130, 246, 0.15)" }, data: [[{ xAxis: winStartSec }, { xAxis: winEndSec }]] },
          markLine: { silent: true, symbol: ["none", "none"], lineStyle: { type: "solid", width: 1, opacity: 0.55 }, data: [{ xAxis: winStartSec }, { xAxis: winEndSec }] },
        },
      ],
    };
  }, [chartData, timeMarker, rangePct, zoomPct]);

  // ✅ CHANGED: Vario is now a LINE chart (same data count as altitude)
  const varioOption = React.useMemo(() => {
    if (!chartData) return {};
    return {
      animation: false,
      grid: { left: 56, right: 16, top: 24, bottom: 24 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        valueFormatter: (v: unknown) => (typeof v === "number" ? v.toFixed(2) : String(v)),
        triggerOn: "none",
        alwaysShowContent: true,
      },
      axisPointer: { snap: true },
      xAxis: { type: "value", min: 0, max: chartData.maxT, axisLabel: { formatter: (v: number) => fmtTime(v) }, axisPointer: { show: true } },
      yAxis: { type: "value", name: "m/s", min: chartData.vMin, max: chartData.vMax, scale: true },
      dataZoom: [{ type: "inside", xAxisIndex: 0, zoomOnMouseWheel: !syncZoom, moveOnMouseMove: !syncZoom, moveOnMouseWheel: !syncZoom }],
      series: [
        {
          name: "Vario",
          type: "line",
          data: chartData.vSpeed,
          showSymbol: false,
          lineStyle: { width: 2 },
          sampling: "lttb",
          markLine: { symbol: ["none", "none"], lineStyle: { type: "dashed", opacity: 0.6 }, data: [{ yAxis: 0 }] },
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
        valueFormatter: (v: unknown) => (typeof v === "number" ? v.toFixed(2) : String(v)),
        triggerOn: "none",
        alwaysShowContent: true,
        formatter: (params: any) => {
          const list = Array.isArray(params) ? params : [params];
          const p0 = list[0];
          const xSec = Math.round(Number(p0?.value?.[0] ?? p0?.axisValue ?? 0));

          const lines = list.map((p: any) => {
            const y = Number(p?.value?.[1] ?? p?.data?.[1] ?? p?.value ?? 0);
            return `${p.marker ?? ""}${p.seriesName}: ${y.toFixed(1)}`;
          });

          return `${lines.join("<br/>")}<br/>${timeMarker}${xSec}s`;
        },
      },
      axisPointer: { snap: true },
      xAxis: { type: "value", min: 0, max: chartData.maxT, axisLabel: { formatter: (v: number) => fmtTime(v) }, axisPointer: { show: true } },
      yAxis: { type: "value", name: "km/h", scale: true },
      dataZoom: [{ type: "inside", xAxisIndex: 0, zoomOnMouseWheel: !syncZoom, moveOnMouseMove: !syncZoom, moveOnMouseWheel: !syncZoom }],
      series: [{ name: "Ground speed", type: "line", data: chartData.hSpeed, showSymbol: false, lineStyle: { width: 2 } }],
    };
  }, [chartData, syncZoom, timeMarker]);

  const altEvents = React.useMemo(() => {
    return {
      dataZoom: () => {
        if (syncingRef.current) return;

        const alt = altRef.current?.getEchartsInstance?.();
        if (!alt) return;

        const dzs = alt.getOption()?.dataZoom as any[] | undefined;
        if (!dzs?.length) return;

        const dz = dzs.find((z) => z.type === "slider") ?? dzs.find((z) => z.type === "inside") ?? dzs[0];
        if (!dz) return;

        if (typeof dz.start === "number" && typeof dz.end === "number") {
          setZoomPct([dz.start, dz.end]);
        }

        if (!syncZoom) return;

        const vario = varioRef.current?.getEchartsInstance?.();
        const speed = speedRef.current?.getEchartsInstance?.();
        if (!vario || !speed) return;

        try {
          syncingRef.current = true;

          if (typeof dz.start === "number" && typeof dz.end === "number") {
            for (const ch of [vario, speed]) ch.dispatchAction({ type: "dataZoom", xAxisIndex: 0, start: dz.start, end: dz.end });
          } else if (typeof dz.startValue === "number" && typeof dz.endValue === "number") {
            for (const ch of [vario, speed]) ch.dispatchAction({ type: "dataZoom", xAxisIndex: 0, startValue: dz.startValue, endValue: dz.endValue });
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

        const tSec = Math.round(x);
        pendingHoverSecRef.current = tSec;

        if (hoverRafRef.current == null) {
          hoverRafRef.current = requestAnimationFrame(() => {
            hoverRafRef.current = null;
            const next = pendingHoverSecRef.current;
            pendingHoverSecRef.current = null;
            if (next == null) return;
            mapRef.current?.setHoverTSec(next);
          });
        }

        const alt = altRef.current?.getEchartsInstance?.();
        const vario = varioRef.current?.getEchartsInstance?.();
        const speed = speedRef.current?.getEchartsInstance?.();
        if (!alt || !vario || !speed) return;

        // ✅ same index basis (same point count now)
        const iAlt = safeClosestIndex(chartData.alt, x);
        const i = iAlt;

        try {
          syncingRef.current = true;

          alt.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: iAlt });
          vario.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: i });
          speed.dispatchAction({ type: "showTip", seriesIndex: 0, dataIndex: i });

          vario.dispatchAction({ type: "updateAxisPointer", xAxisIndex: 0, value: x });
          speed.dispatchAction({ type: "updateAxisPointer", xAxisIndex: 0, value: x });
        } finally {
          syncingRef.current = false;
        }
      },

      globalout: () => {
        pendingHoverSecRef.current = null;
        if (hoverRafRef.current != null) {
          cancelAnimationFrame(hoverRafRef.current);
          hoverRafRef.current = null;
        }

        if (!syncZoom) return;
        for (const ch of [altRef.current?.getEchartsInstance?.(), varioRef.current?.getEchartsInstance?.(), speedRef.current?.getEchartsInstance?.()].filter(Boolean) as any[]) {
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
            <Button leftSection={<IconMap size={16} />} variant="light" onClick={() => setMapOpen(true)} disabled={!computed?.fixes?.length}>
              Map open
            </Button>
          ) : (
            <Button leftSection={<IconX size={16} />} variant="light" onClick={() => setMapOpen(false)}>
              Map close
            </Button>
          )}

          <Checkbox label="Topo" checked={baseMap === "topo"} onChange={(e) => setBaseMap(e.currentTarget.checked ? "topo" : "osm")} />
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
                    <b>Fixes:</b> {computed.fixesCount} &nbsp; <b>Series:</b> {computed.series.length} &nbsp; <b>Windows:</b>{" "}
                    {computed.windows.length} (windowSec={windowSec})
                  </Text>

                  <Checkbox label="Sync zoom (Altitude drives others)" checked={syncZoom} onChange={(e) => setSyncZoom(e.currentTarget.checked)} />
                </Group>

                <Box ref={containerRef} style={{ display: "flex", alignItems: "stretch", width: "100%" }}>
                  {/* LEFT: Charts */}
                  <Box style={{ width: mapOpen ? `${splitPct}%` : "100%", paddingRight: mapOpen ? 12 : 0, transition: "width 120ms ease" }}>
                    <Stack gap="xs">
                      <Box>
                        <Text size="sm" fw={600} mb={4}>
                          Altitude (Zeitfenster ziehbar)
                        </Text>
                        <EChartsReact echarts={echarts} ref={altRef as any} option={altOption} style={{ height: 320, width: "100%" }} onEvents={altEvents} lazyUpdate />
                      </Box>

                      <Box>
                        <Text size="sm" fw={600} mb={4}>
                          Vertical speed (Vario)
                        </Text>
                        <EChartsReact echarts={echarts} ref={varioRef as any} option={varioOption} style={{ height: 220, width: "100%" }} notMerge lazyUpdate />
                      </Box>

                      <Box>
                        <Text size="sm" fw={600} mb={4}>
                          Horizontal speed
                        </Text>
                        <EChartsReact echarts={echarts} ref={speedRef as any} option={speedOption} style={{ height: 220, width: "100%" }} notMerge lazyUpdate />
                      </Box>
                    </Stack>
                  </Box>

                  {/* MIDDLE: Drag Handle */}
                  {mapOpen && (
                    <Box
                      onPointerDown={onDividerPointerDown}
                      onPointerMove={onDividerPointerMove}
                      onPointerUp={onDividerPointerUp}
                      style={{ width: 12, cursor: "col-resize", userSelect: "none", touchAction: "none", display: "flex", alignItems: "stretch", marginRight: 12 }}
                    >
                      <Box style={{ width: 1, margin: "0 auto", background: "var(--mantine-color-gray-3)" }} />
                    </Box>
                  )}

                  {/* RIGHT: Map */}
                  {mapOpen && (
                    <Box style={{ width: `${100 - splitPct}%`, minWidth: 260, display: "flex", flexDirection: "column", alignItems: "stretch" }}>
                      <Text size="sm" fw={600} mb={4}>
                        Map
                      </Text>

                      <Box style={{ flex: 1, minHeight: 0 }}>
                        <FlightMap
                          ref={mapRef}
                          fixes={computed.fixes}
                          baseMap={baseMap}
                          watchKey={`${mapOpen}-${splitPct}-${baseMap}-${id}`}
                          rangePct={rangePct}
                          onRangePctChange={setRangePctSafe}
                        />
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
