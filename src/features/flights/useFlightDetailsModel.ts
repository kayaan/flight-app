// src/features/flights/useFlightDetailsModel.ts
import * as React from "react";
import * as echarts from "echarts";

import type { FlightRecordDetails } from "./flights.types";
import { buildFlightSeries, calculationWindow, parseIgcFixes } from "./igc/igc.series";
import { flightApi } from "./flights.api";
import type { FixPoint } from "./igc";

import { useFlightHoverStore } from "./store/flightHover.store";
import { useTimeWindowStore } from "./store/timeWindow.store";
import { detectClimbPhases } from "./analysis/turns/detectClimbPhases";
import { useFlightDetailsUiStore } from "./store/flightDetailsUi.store";
import { detectThermalCirclesInClimbs, type ThermalCircle } from "./analysis/turns/detectThermalCircles";

import {
    ALT_AXIS_POINTER,
    ALT_DATAZOOM,
    ALT_GRID,
    SPEED_DATAZOOM,
    VARIO_DATAZOOM,
    buildActiveRangeMarkLine,
    buildClimbLinesSeries,
    buildWindowMarkLine,
    calculateSmoothedSpeedFromSeries,
    calculateVarioFromSeries,
    clamp,
    colorForClimbIndex,
    computeSegmentStats,
    extractTSec,
    fmtTime,
    type AxisPointerLabelParams,
    type ChartKind,
} from "./flightDetails.engine";

const EMPTY_FIXES: FixPoint[] = [];
const EMPTY_THERMALS: ThermalCircle[] = [];

type GoToFlightFn = (targetId: number) => void;

export function useFlightDetailsModel(args: { id: string; token: string | null | undefined; goToFlight: GoToFlightFn }) {
    const { id, token, goToFlight } = args;

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

    const showClimbLinesOnChart = useFlightDetailsUiStore((s) => s.showClimbLinesOnChart);
    const showThermalsOnMap = useFlightDetailsUiStore((s) => s.showThermalsOnMap);
    const setShowClimbLinesOnChart = useFlightDetailsUiStore((s) => s.setShowClimbLinesOnChart);
    const setShowThermalsOnMap = useFlightDetailsUiStore((s) => s.setShowThermalsOnMap);

    const setShowAlt = useFlightDetailsUiStore((s) => s.setShowAlt);
    const setShowVario = useFlightDetailsUiStore((s) => s.setShowVario);
    const setShowSpeed = useFlightDetailsUiStore((s) => s.setShowSpeed);

    // keep TimeWindow-store synced (AutoFit logic lives there)
    const setAutoFitSelectionInWindowStore = useTimeWindowStore((s) => s.setAutoFitSelection);
    React.useEffect(() => {
        setAutoFitSelectionInWindowStore(autoFitSelection);
    }, [autoFitSelection, setAutoFitSelectionInWindowStore]);

    // hover sync
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

    // navigation ids
    const [flightIds, setFlightIds] = React.useState<number[]>([]);
    const [navBusy, setNavBusy] = React.useState(false);

    React.useEffect(() => {
        let cancelled = false;

        async function loadIds() {
            try {
                setNavBusy(true);

                const api: any = flightApi as any;
                const listFn = api.listFlights ?? api.getFlights ?? api.list ?? api.getAllFlights ?? null;
                if (!listFn) return;

                const res = await listFn(token ?? "");

                const items =
                    Array.isArray(res)
                        ? res
                        : Array.isArray(res?.items)
                            ? res.items
                            : Array.isArray(res?.flights)
                                ? res.flights
                                : Array.isArray(res?.data)
                                    ? res.data
                                    : [];

                const ids = items.map((x: any) => Number(x?.id)).filter((n: any) => Number.isFinite(n)) as number[];

                if (!cancelled) setFlightIds(ids);
            } catch {
                // ignore
            } finally {
                if (!cancelled) setNavBusy(false);
            }
        }

        loadIds();
        return () => {
            cancelled = true;
        };
    }, [token]);

    const currentIdNum = Number(id);

    const currentFlightPos = React.useMemo(() => {
        if (!Number.isFinite(currentIdNum)) return -1;
        return flightIds.indexOf(currentIdNum);
    }, [flightIds, currentIdNum]);

    const prevFlightId = currentFlightPos > 0 ? flightIds[currentFlightPos - 1] : null;
    const nextFlightId =
        currentFlightPos >= 0 && currentFlightPos < flightIds.length - 1 ? flightIds[currentFlightPos + 1] : null;



    // flight load
    const [flight, setFlight] = React.useState<FlightRecordDetails | null>(null);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const [windowSec] = React.useState(calculationWindow);

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

    // parse + compute
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
            minGainM: 100,
            dropPct: 0.3,
            minDropAbsM: 75,
            minLenPts: 25,
        });
    }, [computed?.fixesFull]);

    const [activeClimbIndex, setActiveClimbIndex] = React.useState<number | null>(null);
    const hasClimbs = climbs.length > 0;
    const climbNavActive = activeClimbIndex != null && hasClimbs;

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

    const prevClimb = React.useCallback(() => {
        if (!hasClimbs) return;
        setActiveClimbIndex((prev) => {
            if (prev == null) return climbs.length - 1;
            return (prev - 1 + climbs.length) % climbs.length;
        });
    }, [hasClimbs, climbs.length]);

    const nextClimb = React.useCallback(() => {
        if (!hasClimbs) return;
        setActiveClimbIndex((prev) => {
            if (prev == null) return 0;
            return (prev + 1) % climbs.length;
        });
    }, [hasClimbs, climbs.length]);

    const clearActiveClimb = React.useCallback(() => setActiveClimbIndex(null), []);

    const activeClimb = React.useMemo(() => {
        if (activeClimbIndex == null) return null;
        if (!climbs.length) return null;
        const i = clamp(activeClimbIndex, 0, climbs.length - 1);
        return climbs[i] ?? null;
    }, [activeClimbIndex, climbs]);

    // thermals
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

    const thermalCount = thermals?.length ?? 0;

    // markline data for climbs
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

            data.push({ xAxis: startSec, lineStyle: { color, width: 2, opacity: 0.9 }, label: { show: false } });
            data.push({ xAxis: endSec, lineStyle: { color, width: 2, opacity: 0.9 }, label: { show: false } });
        }

        return data;
    }, [computed?.fixesFull, climbs]);

    // RDP worker -> fixesLite
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

        worker.onerror = () => worker.terminate();

        worker.postMessage({
            jobId,
            fixes: full,
            epsilonMeters: RDP_EPS_METERS,
            minPointsNoRdp: RDP_MIN_POINTS,
        });

        return () => worker.terminate();
    }, [computed?.fixesFull]);

    const computedWithLite = React.useMemo(() => {
        if (!computed) return null;
        return { ...computed, fixesLite: fixesLite ?? computed.fixesFull };
    }, [computed, fixesLite]);

    // chartData
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

    // time window store
    const win = useTimeWindowStore((s) => s.window);
    const setWindow = useTimeWindowStore((s) => s.setWindow);
    const setDragging = useTimeWindowStore((s) => s.setDragging);
    const isDragging = useTimeWindowStore((s) => s.isDragging);
    const setWindowThrottled = useTimeWindowStore((s) => s.setWindowThrottled);

    const goFlight = React.useCallback(
        (targetId: number) => {
            // reset window + climb hover etc are handled here (central)
            setActiveClimbIndex(null);
            setHoveredClimbIndex(null);
            setWindow(null);
            setDragging(false);

            goToFlight(targetId);
        },
        [goToFlight, setWindow, setDragging]
    );

    const winStartSec = win?.startSec ?? 0;
    const winEndSec = win?.endSec ?? 0;
    const winTotalSec = win?.totalSec ?? (chartData?.maxT ?? 0);

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

        return { startSec: a, endSec: b };
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
            if (Number.isFinite(s) && Number.isFinite(e)) return { startSec: s as number, endSec: e as number };
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

    // charts: instances + ready + group connect
    const chartGroupId = React.useMemo(() => `flight-${id}-charts`, [id]);

    const altInstRef = React.useRef<any>(null);
    const varioInstRef = React.useRef<any>(null);
    const speedInstRef = React.useRef<any>(null);
    const [chartsReadyTick, setChartsReadyTick] = React.useState(0);

    const [chartReady, setChartReady] = React.useState({ alt: false, vario: false, speed: false });

    const makeOnChartReady = React.useCallback(
        (kind: "alt" | "vario" | "speed") => {
            return (inst: any) => {
                if (kind === "alt") altInstRef.current = inst;
                if (kind === "vario") varioInstRef.current = inst;
                if (kind === "speed") speedInstRef.current = inst;

                inst.group = chartGroupId;
                setChartReady((r) => ({ ...r, [kind]: true }));
                setChartsReadyTick((x) => x + 1);
            };
        },
        [chartGroupId]
    );

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

    // base option
    const baseOption = React.useMemo(() => {
        return {
            animation: false,
            tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
            axisPointer: { snap: true, link: [{ xAxisIndex: "all" }] },
        };
    }, []);

    const altitudeTooltipFormatter = (params: any[]) => {
        const y = params?.[0]?.value?.[1];
        const h = typeof y === "number" ? y : Number(y);
        if (!Number.isFinite(h)) return "";
        return `<strong>${Math.round(h)} m</strong>`;
    };

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
            xAxis: { type: "value", min: 0, max: chartData.maxT, axisLabel: { formatter: (v: number) => fmtTime(v) } },
            yAxis: { type: "value", name: "m", min: chartData.altMin, max: chartData.altMax, scale: true },
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
    }, [
        chartData,
        baseOption,
        windowMarkLine,
        varioWindowSec,
        activeRange,
        climbMarkLineData,
        showClimbLinesOnChart,
        activeClimbOverlay,
    ]);

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

    // zoom helpers (keep as actions)
    const getVisibleCharts = React.useCallback(() => {
        const out: Array<{ kind: ChartKind; inst: any }> = [];
        if (showAlt && altInstRef.current) out.push({ kind: "alt", inst: altInstRef.current });
        if (showVario && varioInstRef.current) out.push({ kind: "vario", inst: varioInstRef.current });
        if (showSpeed && speedInstRef.current) out.push({ kind: "speed", inst: speedInstRef.current });
        return out;
    }, [showAlt, showVario, showSpeed]);

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

    React.useEffect(() => {
        if (!zoomSyncEnabled) return;
        if (!win) return;
        if (isDragging) return;
        zoomChartsToWindow();
    }, [zoomSyncEnabled, isDragging, zoomChartsToWindow, win]);

    // selection / range select (kept as in original)
    const dragRef = React.useRef<{ dragging: boolean; startT: number | null; lastT: number | null; owner: ChartKind | null }>({
        dragging: false,
        startT: null,
        lastT: null,
        owner: null,
    });

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
        const cleanups: Array<(() => void) | undefined> = [];

        if (showAlt && altInstRef.current) cleanups.push(attachRangeSelect("alt"));
        if (showVario && varioInstRef.current) cleanups.push(attachRangeSelect("vario"));
        if (showSpeed && speedInstRef.current) cleanups.push(attachRangeSelect("speed"));

        return () => {
            for (const fn of cleanups) fn?.();
        };
    }, [showAlt, showVario, showSpeed, chartsReadyTick, attachRangeSelect]);

    // map focus pulse (kept here)
    const [mapFocusKey, setMapFocusKey] = React.useState(0);
    const [pulseActive, setPulseActive] = React.useState(false);

    const pulse = React.useCallback(() => {
        setPulseActive(true);
        window.setTimeout(() => setPulseActive(false), 260);
    }, []);

    // suppress one-shot auto pan
    const suppressAutoPanOnceRef = React.useRef(false);

    function applyRangeToCharts(charts: Array<{ kind: "alt" | "vario" | "speed"; inst: any }>, startValue: number, endValue: number) {
        for (const { kind, inst } of charts) {
            const idxs = kind === "alt" ? [0, 1] : [0];
            for (const dataZoomIndex of idxs) inst.dispatchAction?.({ type: "dataZoom", dataZoomIndex, startValue, endValue });
        }
    }

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

    // map data
    const mapFixesFull = computedWithLite?.fixesFull ?? EMPTY_FIXES;
    const mapFixesLite = computedWithLite?.fixesLite ?? EMPTY_FIXES;
    const mapThermals = thermals ?? EMPTY_THERMALS;

    // climb drawer sort
    type ClimbSortMode = "normal" | "gainDesc" | "gainAsc";
    const [climbSortMode, setClimbSortMode] = React.useState<ClimbSortMode>("normal");
    const [hoveredClimbIndex, setHoveredClimbIndex] = React.useState<number | null>(null);

    const sortedClimbs = React.useMemo(() => {
        if (climbSortMode === "normal") return climbs;

        const copy = [...climbs];
        if (climbSortMode === "gainDesc") copy.sort((a, b) => b.gainM - a.gainM);
        else if (climbSortMode === "gainAsc") copy.sort((a, b) => a.gainM - b.gainM);
        return copy;
    }, [climbs, climbSortMode]);

    return {
        // state
        flight,
        busy,
        error,

        computed,
        chartData,

        // nav
        flightIds,
        navBusy,
        currentFlightPos,
        prevFlightId,
        nextFlightId,
        goFlight,

        // climbs/thermals
        climbs,
        sortedClimbs,
        climbSortMode,
        setClimbSortMode,
        hasClimbs,
        climbNavActive,
        activeClimbIndex,
        setActiveClimbIndex,
        prevClimb,
        nextClimb,
        clearActiveClimb,
        hoveredClimbIndex,
        setHoveredClimbIndex,

        thermals,
        thermalCount,
        activeClimb,
        activeClimbGainM,
        activeClimbDurSec,
        suppressAutoPanOnceRef,

        // window + stats
        win,
        winStartSec,
        winEndSec,
        winTotalSec,
        statsSource,
        statsRange,
        segmentStats,

        // options/events
        chartEvents,
        altOption,
        varioOption,
        speedOption,

        // chart controls
        showAlt,
        showVario,
        showSpeed,
        setShowAlt,
        setShowVario,
        setShowSpeed,

        showStats,
        setShowStats,

        followEnabled,
        setFollowEnabled,

        syncEnabled,
        setSyncEnabled,

        zoomSyncEnabled,
        setZoomSyncEnabled,

        varioWindowSec,
        setVarioWindowSec,

        autoFitSelection,
        setAutoFitSelectionUi,

        baseMap,
        setBaseMap,

        showClimbLinesOnChart,
        setShowClimbLinesOnChart,
        showThermalsOnMap,
        setShowThermalsOnMap,

        zoomDisabled,
        zoomChartsToWindow,
        resetSelection,

        // echarts
        makeOnChartReady,

        // map focus pulse
        mapFocusKey,
        pulseActive,
        focusActiveClimb,

        // map data
        mapFixesFull,
        mapFixesLite,
        mapThermals,
    };
}