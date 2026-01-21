import * as React from "react";
import { MapContainer, TileLayer, Polyline, useMap, useMapEvents, CircleMarker } from "react-leaflet";
import type { LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Box, Group, Text, RangeSlider } from "@mantine/core";


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
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
    topo: {
        key: "topo",
        url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
        attribution:
            'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    },
} as const;

/**
 * RangeSlider, aber zusätzlich:
 * - Drag auf dem Track/“Fenster” verschiebt die Range als Ganzes (Breite bleibt gleich)
 * - Handles bleiben normal zum Resizen
 *
 * Wichtig: Wir fangen Pointer-Events auf dem Root ab und prüfen, ob das Ziel im Slider liegt.
 */
function WindowRangeSlider({
    value,
    onChange,
    min = 0,
    max = 100,
    step = 1,
    minRange = 1,
    mb,
}: {
    value: [number, number];
    onChange: (v: [number, number]) => void;
    min?: number;
    max?: number;
    step?: number;
    minRange?: number;
    mb?: any;
}) {
    const wrapRef = React.useRef<HTMLDivElement | null>(null);

    const dragging = React.useRef(false);
    const startClientX = React.useRef(0);
    const startValue = React.useRef<[number, number]>(value);
    const rectRef = React.useRef<DOMRect | null>(null);

    React.useEffect(() => {
        if (!dragging.current) startValue.current = value;
    }, [value]);

    function normalize(r: [number, number]): [number, number] {
        let a = clamp(r[0], min, max);
        let b = clamp(r[1], min, max);
        if (a > b) [a, b] = [b, a];
        if (b - a < minRange) b = clamp(a + minRange, min, max);
        return [a, b];
    }

    const onPointerDownCapture = (e: React.PointerEvent) => {
        const target = e.target as HTMLElement;
        const wrap = wrapRef.current;
        if (!wrap) return;

        // Thumbs -> Mantine soll normal arbeiten (Resize)
        if (target.closest(".ws-thumb")) return;

        // Drag nur wenn auf der selektierten Bar geklickt wird (nicht Track!)
        if (!target.closest(".ws-bar")) return;

        // Mantine darf KEINEN Klick sehen (sonst Jump)
        e.preventDefault();
        e.stopPropagation();

        dragging.current = true;
        startClientX.current = e.clientX;
        startValue.current = value;
        rectRef.current = wrap.getBoundingClientRect();

        (wrap as HTMLDivElement).setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: React.PointerEvent) => {
        if (!dragging.current) return;

        const rect = rectRef.current;
        if (!rect || rect.width <= 0) return;

        const dxPx = e.clientX - startClientX.current;
        const dxValue = (dxPx / rect.width) * (max - min);

        const width = startValue.current[1] - startValue.current[0];

        // step-runden
        const rawStart = startValue.current[0] + dxValue;
        const steppedStart = Math.round(rawStart / step) * step;

        const newStart = clamp(steppedStart, min, max - width);
        onChange(normalize([newStart, newStart + width]));
    };

    const onPointerUp = () => {
        dragging.current = false;
        rectRef.current = null;
    };

    return (
        <div
            ref={wrapRef}
            onPointerDownCapture={onPointerDownCapture}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{ touchAction: "none" }}
        >
            <RangeSlider
                value={value}
                onChange={(v) => onChange(normalize(v))}
                min={min}
                max={max}
                step={step}
                minRange={minRange}
                mb={mb}
                // ✅ garantiert passende Klassen (KEIN "mantine-..." Raten mehr)
                classNames={{
                    root: "ws-root",
                    track: "ws-track",
                    bar: "ws-bar",
                    thumb: "ws-thumb",
                }}
            />
        </div>
    );
}


export function FlightMap({
    points,
    vario,
    watchKey,
    baseMap = "osm",

    // ✅ controlled window from parent
    rangePct,
    onRangePctChange,

    hoverPoint,
}: {
    points: LatLngTuple[];
    vario?: number[];
    watchKey?: unknown;
    baseMap?: BaseMap;

    rangePct: [number, number];
    onRangePctChange: (r: [number, number]) => void;

    hoverPoint?: LatLngTuple | null;
}) {
    const totalPoints = points.length;
    const hasTrack = totalPoints >= 2;




    const initialZoom = hasTrack ? 13 : 11;
    const [zoom, setZoom] = React.useState<number>(initialZoom);

    const totalSeconds = Math.max(0, totalPoints - 1);

    const effectiveRange = React.useMemo<[number, number]>(() => rangePct, [rangePct]);

    const startSeconds = Math.floor((effectiveRange[0] / 100) * totalSeconds);
    const endSeconds = Math.floor((effectiveRange[1] / 100) * totalSeconds);

    const { startIdx, endIdx } = React.useMemo(() => {
        if (totalPoints < 2) return { startIdx: 0, endIdx: 0 };

        const s = clamp(Math.floor((effectiveRange[0] / 100) * (totalPoints - 1)), 0, totalPoints - 2);
        const e = clamp(Math.floor((effectiveRange[1] / 100) * (totalPoints - 1)), s + 1, totalPoints - 1);

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

    // dezent: ganze Route
    const ghostColor = "rgba(120,120,130,0.55)";
    const ghostOutlineColor = "rgba(20,20,25,0.20)";

    // etwas dünner als die aktive Route
    const ghostLine = Math.max(1.6, line * 0.75);
    const ghostOutline = ghostLine + 2;

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

                <Text c="dimmed">
                    {formatTime(startSeconds)} → {formatTime(endSeconds)} / {formatTime(totalSeconds)}
                </Text>
            </Group>

            {/* ✅ Window Slider: Handles = resize, Drag in the middle = move */}
            <WindowRangeSlider
                value={rangePct}
                onChange={onRangePctChange}
                min={0}
                max={100}
                step={1}
                minRange={1}
                mb="sm"
            />

            <Box style={{ flex: 1, minHeight: 0 }}>
                <MapContainer center={center} zoom={initialZoom} style={{ height: "100%", width: "100%" }} preferCanvas>
                    <TileLayer key={tile.key} url={tile.url} attribution={tile.attribution} />


                    {points.length >= 2 && (
                        <>
                            {/* optional mini-outline, damit es auch auf hellen Tiles sichtbar bleibt */}
                            <Polyline
                                positions={points}
                                pathOptions={{
                                    color: ghostOutlineColor,
                                    weight: ghostOutline,
                                    opacity: 1,
                                    lineCap: "round",
                                    lineJoin: "round",
                                }}
                            />
                            <Polyline
                                positions={points}
                                pathOptions={{
                                    color: ghostColor,
                                    weight: ghostLine,
                                    opacity: 1,
                                    lineCap: "round",
                                    lineJoin: "round",
                                }}
                            />
                        </>
                    )}

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

                    {hoverPoint && (
                        <CircleMarker
                            center={hoverPoint}
                            radius={6}
                            pathOptions={{
                                color: "#111",
                                weight: 2,
                                opacity: 0.9,
                                fillOpacity: 0.9,
                            }}
                        />
                    )}

                    {!segments && clippedPoints.length >= 2 && <Polyline positions={clippedPoints} />}

                    <ZoomWatcher onZoom={setZoom} />
                    <MapAutoResize watchKey={watchKey} />
                </MapContainer>
            </Box>
        </Box>
    );
}
