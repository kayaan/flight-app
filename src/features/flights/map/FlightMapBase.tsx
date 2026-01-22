// src/features/flights/map/FlightMapBase.tsx
// ✅ Performance goals:
// - Draws ALL points (full resolution) for the track (no sampling, no Leaflet smoothing)
// - Expensive work (chunk building) does NOT depend on zoom → no rebuild on zoom
// - Zoom state updates are deduped (no redundant setState)
// - Hover marker uses nearest-fix binary search (no Map.get exact second)
// - Chunk building is O(points_in_window) and runs ONLY when fixes/range changes

import * as React from "react";
import { MapContainer, TileLayer, Polyline, useMap, useMapEvents, Marker } from "react-leaflet";
import type { LatLngTuple, Marker as LeafletMarker, LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Box, Group, Text, RangeSlider } from "@mantine/core";

type BaseMap = "osm" | "topo";

export type FlightMapHandle = {
    setHoverTSec: (tSec: number | null) => void;
};

export type FixPoint = {
    tSec: number; // relative seconds
    lat: number;
    lon: number;
    altitudeM: number;
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
    // keep stable-ish; adjust weights only (cheap)
    const line = clamp(7.0 - z * 0.45, 2.2, 4.8);
    const outlineExtra = clamp(Math.round(2.0 + (z - 12) * 0.9), 2, 6);
    const outlineOpacity = clamp(0.20 + (z - 12) * 0.15, 0.2, 0.75);
    return { line, outlineExtra, outlineOpacity };
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

function MapAutoResize({ watchKey }: { watchKey?: unknown }) {
    const map = useMap();
    const rafRef = React.useRef<number | null>(null);

    React.useEffect(() => {
        const invalidate = () => {
            if (rafRef.current != null) return;
            rafRef.current = requestAnimationFrame(() => {
                rafRef.current = null;
                map.invalidateSize();
            });
        };

        invalidate();

        const el = map.getContainer();
        if (!el) return;

        const ro = new ResizeObserver(() => invalidate());
        ro.observe(el);

        return () => {
            if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
            ro.disconnect();
        };
    }, [map, watchKey]);

    return null;
}

function FitToTrackOnce({
    bounds,
    watchKey,
}: {
    bounds: LatLngBoundsExpression | null;
    watchKey?: unknown;
}) {
    const map = useMap();
    const didRef = React.useRef<unknown>(null);

    React.useEffect(() => {
        if (!bounds) return;
        if (didRef.current === watchKey) return;
        didRef.current = watchKey;
        map.fitBounds(bounds, { padding: [18, 18] });
    }, [map, bounds, watchKey]);

    return null;
}

function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
    const lastRef = React.useRef<number | null>(null);

    useMapEvents({
        zoomend: (e) => {
            const z = e.target.getZoom();
            if (lastRef.current === z) return; // ✅ dedupe
            lastRef.current = z;
            onZoom(z);
        },
    });

    return null;
}

/* ---------------- WindowRangeSlider (unchanged) ---------------- */

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

        if (target.closest(".ws-thumb")) return;
        if (!target.closest(".ws-bar")) return;

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

/* ---------------- helpers ---------------- */

function nearestFixIndexByTSec(fixes: FixPoint[], tSec: number) {
    const n = fixes.length;
    if (n === 0) return 0;
    if (tSec <= fixes[0].tSec) return 0;
    if (tSec >= fixes[n - 1].tSec) return n - 1;

    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (fixes[mid].tSec < tSec) lo = mid + 1;
        else hi = mid;
    }
    const i1 = lo;
    const i0 = lo - 1;
    return Math.abs(fixes[i0].tSec - tSec) <= Math.abs(fixes[i1].tSec - tSec) ? i0 : i1;
}

function lowerBoundTSec(fixes: FixPoint[], tSec: number) {
    // first index with fixes[i].tSec >= tSec
    let lo = 0;
    let hi = fixes.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (fixes[mid].tSec < tSec) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function upperBoundTSec(fixes: FixPoint[], tSec: number) {
    // last index with fixes[i].tSec <= tSec
    let lo = 0;
    let hi = fixes.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (fixes[mid].tSec <= tSec) lo = mid + 1;
        else hi = mid;
    }
    return Math.max(0, lo - 1);
}

// ✅ color thresholds DO NOT depend on zoom (important!)
// This prevents rebuild of chunks on zoom.
function colorForVario(v: number) {
    const a = Math.abs(v);
    if (a < 0.5) return "#60a5fa"; // neutral blue

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
}

type ColorChunk = { color: string; positions: LatLngTuple[] };

// Build colored chunks directly from fixes window (no intermediate arrays)
// Complexity: O(windowPoints). Runs ONLY when fixes/range changes.
function buildChunksFromFixesWindow(fixes: FixPoint[], startIdx: number, endIdx: number): ColorChunk[] {
    const n = fixes.length;
    if (n < 2) return [];
    const s = clamp(startIdx, 0, n - 2);
    const e = clamp(endIdx, s + 1, n - 1);

    const chunks: ColorChunk[] = [];

    let lastColor = "";
    let cur: LatLngTuple[] | null = null;

    let lastV = 0;
    for (let i = s; i < e; i++) {
        const a = fixes[i];
        const b = fixes[i + 1];

        const dt = b.tSec - a.tSec;
        if (dt > 0) lastV = (b.altitudeM - a.altitudeM) / dt;

        const c = colorForVario(lastV);

        const pA: LatLngTuple = [a.lat, a.lon];
        const pB: LatLngTuple = [b.lat, b.lon];

        if (c !== lastColor || cur == null) {
            if (cur && cur.length >= 2) chunks.push({ color: lastColor, positions: cur });
            lastColor = c;
            cur = [pA, pB];
        } else {
            // continue same color chunk: only append next point
            cur.push(pB);
        }
    }

    if (cur && cur.length >= 2) chunks.push({ color: lastColor, positions: cur });
    return chunks;
}

function computeBounds(points: LatLngTuple[]): LatLngBoundsExpression | null {
    if (points.length < 2) return null;
    // Leaflet can accept an array of points as bounds input
    return points as unknown as LatLngBoundsExpression;
}

/* ---------------- FlightMap ---------------- */

export const FlightMap = React.forwardRef<
    FlightMapHandle,
    {
        baseMap?: BaseMap;
        watchKey?: unknown;

        // window selection for route highlighting
        rangePct: [number, number];
        onRangePctChange: (r: [number, number]) => void;

        // full-res fixes
        fixes: FixPoint[];
    }
>(function FlightMap({ baseMap = "osm", watchKey, rangePct, onRangePctChange, fixes }, ref) {
    const markerRef = React.useRef<LeafletMarker | null>(null);
    const lastHoverRef = React.useRef<number | null>(null);

    // ✅ hover marker: nearest fix (fast), no exact-second Map lookup
    React.useImperativeHandle(ref, () => ({
        setHoverTSec: (tSec) => {
            if (tSec == null) return;
            if (lastHoverRef.current === tSec) return;
            lastHoverRef.current = tSec;

            if (fixes.length < 1) return;
            const idx = nearestFixIndexByTSec(fixes, tSec);
            const f = fixes[idx];
            markerRef.current?.setLatLng([f.lat, f.lon]);
        },
    }));

    const hasTrack = fixes.length >= 2;
    const initialZoom = hasTrack ? 13 : 11;

    // zoom state is cheap; chunk building does NOT depend on it
    const [zoom, setZoom] = React.useState<number>(initialZoom);
    React.useEffect(() => setZoom(initialZoom), [initialZoom]);

    // ✅ full-res points once (ALL points, no sampling)
    const fullPoints = React.useMemo(() => {
        const out = new Array<LatLngTuple>(fixes.length);
        for (let i = 0; i < fixes.length; i++) {
            const f = fixes[i];
            out[i] = [f.lat, f.lon];
        }
        return out;
    }, [fixes]);

    const totalSeconds = fixes.length ? fixes[fixes.length - 1].tSec : 0;

    // time window boundaries in seconds
    const [startSec, endSec] = React.useMemo(() => {
        const a = clamp(rangePct[0], 0, 100);
        const b = clamp(rangePct[1], 0, 100);
        const start = (Math.min(a, b) / 100) * totalSeconds;
        const end = (Math.max(a, b) / 100) * totalSeconds;
        return [start, end];
    }, [rangePct, totalSeconds]);

    // indices for window selection (binary search on full-res fixes)
    const { startIdx, endIdx } = React.useMemo(() => {
        if (fixes.length < 2) return { startIdx: 0, endIdx: 0 };
        const s = clamp(lowerBoundTSec(fixes, startSec), 0, fixes.length - 2);
        const e = clamp(upperBoundTSec(fixes, endSec), s + 1, fixes.length - 1);
        return { startIdx: s, endIdx: e };
    }, [fixes, startSec, endSec]);

    // ✅ EXPENSIVE: build chunks only when fixes OR range changes (NOT on zoom)
    const colorChunks = React.useMemo(() => {
        if (!hasTrack) return [];
        return buildChunksFromFixesWindow(fixes, startIdx, endIdx);
    }, [hasTrack, fixes, startIdx, endIdx]);

    const center: LatLngTuple = fullPoints.length ? fullPoints[0] : [48.1372, 11.5756];

    // fit to FULL track once per watchKey (layout / baseMap / flight change)
    const bounds = React.useMemo(() => computeBounds(fullPoints), [fullPoints]);

    const { line, outlineExtra, outlineOpacity } = React.useMemo(() => weightsForZoom(zoom), [zoom]);
    const outlineWeight = line + outlineExtra;
    const OUTLINE = "rgba(20,20,25,0.45)";

    const tile = TILE[baseMap];

    // marker start
    const startPos: LatLngTuple = center;

    return (
        <Box style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <Group justify="space-between" mb="xs">
                <Text fw={600}>Zeitfenster</Text>
                <Text c="dimmed">
                    {formatTime(startSec)} → {formatTime(endSec)} / {formatTime(totalSeconds)}
                </Text>
            </Group>

            <WindowRangeSlider value={rangePct} onChange={onRangePctChange} min={0} max={100} step={1} minRange={1} mb="sm" />

            <Box style={{ flex: 1, minHeight: 0 }}>
                <MapContainer center={center} zoom={initialZoom} style={{ height: "100%", width: "100%" }} preferCanvas>
                    <TileLayer key={tile.key} url={tile.url} attribution={tile.attribution} />

                    {/* ✅ FULL track (ALL points), smoothFactor 0 = no Leaflet simplification */}
                    {fullPoints.length >= 2 && (
                        <Polyline
                            positions={fullPoints}
                            pathOptions={{
                                color: "rgba(120,120,130,0.55)",
                                weight: Math.max(2.2, line * 0.9),
                                opacity: 1,
                                lineCap: "round",
                                lineJoin: "round",
                                smoothFactor: 0, // ✅ show all points faithfully
                            }}
                        />
                    )}

                    {/* ✅ Highlighted window: batched chunks (few layers) */}
                    {colorChunks.map((ch, i) => (
                        <Polyline
                            key={`o-${i}`}
                            positions={ch.positions}
                            pathOptions={{
                                color: OUTLINE,
                                weight: outlineWeight,
                                opacity: outlineOpacity,
                                lineCap: "round",
                                lineJoin: "round",
                                smoothFactor: 0,
                            }}
                        />
                    ))}
                    {colorChunks.map((ch, i) => (
                        <Polyline
                            key={`c-${i}`}
                            positions={ch.positions}
                            pathOptions={{
                                color: ch.color,
                                weight: line,
                                opacity: 0.98,
                                lineCap: "round",
                                lineJoin: "round",
                                smoothFactor: 0,
                            }}
                        />
                    ))}

                    {/* Hover marker */}
                    <Marker
                        position={startPos}
                        ref={(m) => {
                            markerRef.current = m as unknown as LeafletMarker;
                        }}
                    />

                    <ZoomWatcher onZoom={setZoom} />
                    <MapAutoResize watchKey={watchKey} />
                    <FitToTrackOnce bounds={bounds} watchKey={watchKey} />
                </MapContainer>
            </Box>
        </Box>
    );
});
