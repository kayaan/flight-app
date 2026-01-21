import * as React from "react";
import { MapContainer, TileLayer, Polyline, useMap, useMapEvents } from "react-leaflet";
import type { LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Box, Group, Text, RangeSlider, Tooltip, Slider, ActionIcon } from "@mantine/core";
import { IconLock, IconLockOpen } from "@tabler/icons-react";

type BaseMap = "osm" | "topo";

type ColoredSegment = {
    positions: [LatLngTuple, LatLngTuple];
    color: string;
};

function clamp(n: number, min: number, max: number) {
    return Math.min(max, Math.max(min, n));
}

function formatTime(sec: number) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;

    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
    return `${m}:${String(r).padStart(2, "0")}`;
}

function weightsForZoom(z: number) {
    const line = clamp(7.0 - z * 0.45, 2.2, 4.5);
    return { line };
}

function MapAutoResize({ watchKey }: { watchKey?: unknown }) {
    const map = useMap();

    React.useEffect(() => {
        map.invalidateSize();
        const t = window.setTimeout(() => map.invalidateSize(), 60);
        return () => window.clearTimeout(t);
    }, [map, watchKey]);

    React.useEffect(() => {
        const el = map.getContainer();
        if (!el) return;

        const ro = new ResizeObserver(() => {
            map.invalidateSize();
        });

        ro.observe(el);
        return () => ro.disconnect();
    }, [map]);

    return null;
}

function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
    useMapEvents({
        zoomend: (e) => onZoom(e.target.getZoom()),
    });
    return null;
}

const TILE = {
    osm: {
        key: "osm",
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
    topo: {
        key: "topo",
        url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
        attribution:
            'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    },
} as const;

export function FlightMap({
    points,
    vario,
    watchKey,
    baseMap = "osm",

    // ✅ controlled window from parent
    rangePct,
    onRangePctChange,
}: {
    points: LatLngTuple[];
    vario?: number[];
    watchKey?: unknown;
    baseMap?: BaseMap;

    rangePct: [number, number];
    onRangePctChange: (r: [number, number]) => void;
}) {
    const totalPoints = points.length;
    const hasTrack = totalPoints >= 2;

    const initialZoom = hasTrack ? 13 : 11;
    const [zoom, setZoom] = React.useState<number>(initialZoom);

    const totalSeconds = Math.max(0, totalPoints - 1);

    // Freeze / window-lock (bleibt lokal in map)
    const [freezeWindow, setFreezeWindow] = React.useState(false);
    const [windowStartPct, setWindowStartPct] = React.useState(0);

    React.useEffect(() => {
        if (!freezeWindow) return;
        setWindowStartPct(rangePct[0]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [freezeWindow]);

    const [startPctRaw, endPctRaw] = rangePct;
    const startPct = Math.min(startPctRaw, endPctRaw);
    const endPct = Math.max(startPctRaw, endPctRaw);

    const windowWidthPct = Math.max(1, endPct - startPct);

    const effectiveRange: [number, number] = React.useMemo(() => {
        if (!freezeWindow) return [startPct, endPct];
        const maxStart = 100 - windowWidthPct;
        const s = clamp(windowStartPct, 0, maxStart);
        const e = s + windowWidthPct;
        return [s, e];
    }, [freezeWindow, startPct, endPct, windowStartPct, windowWidthPct]);

    React.useEffect(() => {
        if (!freezeWindow) return;
        onRangePctChange(effectiveRange);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [freezeWindow, effectiveRange]);

    const startSeconds = Math.floor((effectiveRange[0] / 100) * totalSeconds);
    const endSeconds = Math.floor((effectiveRange[1] / 100) * totalSeconds);

    const { startIdx, endIdx } = React.useMemo(() => {
        if (totalPoints < 2) return { startIdx: 0, endIdx: 0 };

        const s = clamp(
            Math.floor((effectiveRange[0] / 100) * (totalPoints - 1)),
            0,
            totalPoints - 2
        );

        const e = clamp(
            Math.floor((effectiveRange[1] / 100) * (totalPoints - 1)),
            s + 1,
            totalPoints - 1
        );

        return { startIdx: s, endIdx: e };
    }, [effectiveRange, totalPoints]);

    const clippedPoints = React.useMemo(() => {
        if (totalPoints < 2) return [];
        return points.slice(startIdx, endIdx + 1);
    }, [points, startIdx, endIdx, totalPoints]);

    const clippedVario = React.useMemo(() => {
        if (!vario) return undefined;
        const segCount = Math.max(0, clippedPoints.length - 1);
        return vario.slice(startIdx, startIdx + segCount);
    }, [vario, startIdx, clippedPoints.length]);

    const segments = React.useMemo(() => {
        const varioColorStep = (v: number) => {
            const a = Math.abs(v);
            const neutralThreshold = zoom >= 14 ? 0.25 : 0.5;
            if (a < neutralThreshold) return "#60a5fa";

            const level = a < 2 ? 1 : a < 3 ? 2 : 3;

            if (v >= 0) {
                if (level === 1) return "#4ade80";
                if (level === 2) return "#22c55e";
                return "#15803d";
            } else {
                if (level === 1) return "#f87171";
                if (level === 2) return "#ef4444";
                return "#991b1b";
            }
        };

        const out: ColoredSegment[] = [];
        if (clippedPoints.length < 2) return null;

        for (let i = 0; i < clippedPoints.length - 1; i++) {
            out.push({
                positions: [clippedPoints[i], clippedPoints[i + 1]],
                color: varioColorStep(clippedVario?.[i] ?? 0),
            });
        }
        return out;
    }, [clippedPoints, clippedVario, zoom]);

    const fallbackCenter: LatLngTuple = [48.1372, 11.5756];
    const center = clippedPoints.length > 0 ? clippedPoints[0] : hasTrack ? points[0] : fallbackCenter;

    React.useEffect(() => {
        setZoom(initialZoom);
    }, [initialZoom]);

    const { line } = React.useMemo(() => weightsForZoom(zoom), [zoom]);
    const tile = TILE[baseMap];

    function clamp01(x: number) {
        return Math.min(1, Math.max(0, x));
    }
    function lerp(a: number, b: number, t: number) {
        return a + (b - a) * t;
    }
    function getOutlineStyle(z: number) {
        const t = clamp01((z - 12) / 3);
        return {
            color: "#61616c",
            extra: Math.round(lerp(1.5, 4.0, t)),
            opacity: lerp(0.18, 0.72, t),
        };
    }

    const { color: OUTLINE, extra, opacity: outlineOpacity } = getOutlineStyle(zoom);
    const outlineWeight = line + extra;

    return (
        <Box style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <Group justify="space-between" mb="xs">
                <Text fw={600}>Zeitfenster</Text>

                <Group gap="xs">
                    <Text c="dimmed">
                        {formatTime(startSeconds)} → {formatTime(endSeconds)} / {formatTime(totalSeconds)}
                    </Text>

                    <Tooltip label={freezeWindow ? "Fenster entsperren" : "Fensterbreite einfrieren"}>
                        <ActionIcon variant="light" onClick={() => setFreezeWindow((v) => !v)} aria-label="Freeze window">
                            {freezeWindow ? <IconLock size={16} /> : <IconLockOpen size={16} />}
                        </ActionIcon>
                    </Tooltip>
                </Group>
            </Group>

            <RangeSlider
                value={rangePct}
                onChange={(next) => {
                    if (freezeWindow) {
                        const width = windowWidthPct;
                        const maxStart = 100 - width;
                        const s = clamp(next[0], 0, maxStart);
                        setWindowStartPct(s);
                        onRangePctChange([s, s + width]);
                        return;
                    }
                    onRangePctChange(next);
                }}
                min={0}
                max={100}
                step={1}
                minRange={1}
                mb="sm"
            />

            {freezeWindow && (
                <Box mb="sm">
                    <Text size="sm" c="dimmed" mb={4}>
                        Fenster verschieben
                    </Text>
                    <Slider
                        value={windowStartPct}
                        onChange={(v) => {
                            setWindowStartPct(v);
                            const width = windowWidthPct;
                            const s = clamp(v, 0, 100 - width);
                            onRangePctChange([s, s + width]);
                        }}
                        min={0}
                        max={100 - windowWidthPct}
                        step={1}
                        label={(v) => `${v}%`}
                    />
                </Box>
            )}

            <Box style={{ flex: 1, minHeight: 0 }}>
                <MapContainer center={center} zoom={initialZoom} style={{ height: "100%", width: "100%" }} preferCanvas>
                    <TileLayer key={tile.key} url={tile.url} attribution={tile.attribution} />

                    {segments?.map((seg, i) => (
                        <React.Fragment key={i}>
                            <Polyline
                                positions={seg.positions}
                                pathOptions={{
                                    color: OUTLINE,
                                    weight: outlineWeight,
                                    opacity: outlineOpacity,
                                    lineCap: "round",
                                    lineJoin: "round",
                                }}
                            />
                            <Polyline
                                positions={seg.positions}
                                pathOptions={{
                                    color: seg.color,
                                    weight: line,
                                    opacity: 0.98,
                                    lineCap: "round",
                                    lineJoin: "round",
                                }}
                            />
                        </React.Fragment>
                    ))}

                    {!segments && clippedPoints.length >= 2 && <Polyline positions={clippedPoints} />}

                    <ZoomWatcher onZoom={setZoom} />
                    <MapAutoResize watchKey={watchKey} />
                </MapContainer>
            </Box>
        </Box>
    );
}
