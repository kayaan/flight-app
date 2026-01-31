// src/features/flights/map/FlightMapBase.tsx
// Standalone Map component (hover marker updates imperatively via zustand subscribe)
// ✅ Fixes UI jank: no React re-render on hover; lightweight circleMarker
// ✅ Window dragging: render Lite during slider drag, Full (colored chunks) after release

import * as React from "react";
import { MapContainer, TileLayer, Polyline, useMap, useMapEvents } from "react-leaflet";
import L, { type LatLngTuple, type LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Box, Group, Text, RangeSlider } from "@mantine/core";
import { useFlightHoverStore } from "../store/flightHover.store";
import { useThrottledValue } from "@mantine/hooks";
import { useTimeWindowStore } from "../store/timeWindow.store";

export type BaseMap = "osm" | "topo";

export type FixPoint = {
    tSec: number; // relative seconds (0..duration)
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

function pct(sec: number, total: number) {
    if (total <= 0) return 0;
    return Math.round((sec / total) * 100);
}

function weightsForZoom(z: number) {
    const line = clamp(7.0 - z * 0.45, 2.2, 4.8);
    const outlineExtra = clamp(Math.round(2.0 + (z - 12) * 0.9), 2, 6);
    const outlineOpacity = clamp(0.20 + (z - 12) * 0.15, 0.2, 0.75);
    return { line, outlineExtra, outlineOpacity };
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
            if (lastRef.current === z) return;
            lastRef.current = z;
            onZoom(z);
        },
    });

    return null;
}

function lowerBoundTSec(fixes: FixPoint[], tSec: number) {
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
    let lo = 0;
    let hi = fixes.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (fixes[mid].tSec <= tSec) lo = mid + 1;
        else hi = mid;
    }
    return Math.max(0, lo - 1);
}

function computeBounds(points: LatLngTuple[]): LatLngBoundsExpression | null {
    if (points.length < 2) return null;
    return points as unknown as LatLngBoundsExpression;
}

// ---- Color-chunk logic (restored) ----

function colorForVario(v: number) {
    const a = Math.abs(v);
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
            cur.push(pB);
        }
    }

    if (cur && cur.length >= 2) chunks.push({ color: lastColor, positions: cur });
    return chunks;
}

/**
 * ✅ Imperative hover marker:
 * - created once (Leaflet circleMarker)
 * - updates via zustand subscribe (no React re-render)
 * - hidden when hoverTSec is null
 */
function HoverMarker({
    fixes,
    followEnabled,
}: {
    fixes: FixPoint[];
    followEnabled: boolean;
}) {
    const map = useMap();

    const coreRef = React.useRef<L.CircleMarker | null>(null);
    const haloRef = React.useRef<L.CircleMarker | null>(null);

    const fixIndex = React.useMemo(() => {
        const m = new Map<number, LatLngTuple>();
        for (const f of fixes) m.set(Math.round(f.tSec), [f.lat, f.lon]);
        return m;
    }, [fixes]);

    const followRef = React.useRef<boolean>(followEnabled);
    React.useEffect(() => {
        followRef.current = followEnabled;
    }, [followEnabled]);

    const lastPanAtRef = React.useRef(0);

    React.useEffect(() => {
        if (coreRef.current || haloRef.current) return;

        const halo = L.circleMarker([0, 0], {
            radius: 12,
            weight: 0,
            opacity: 0,
            fillOpacity: 0,
            fillColor: "#ffffff",
            interactive: false,
        });

        const core = L.circleMarker([0, 0], {
            radius: 5,
            weight: 2,
            color: "#000000",
            opacity: 0,
            fillOpacity: 0,
            fillColor: "#ffffff",
            interactive: false,
        });

        halo.addTo(map);
        core.addTo(map);

        haloRef.current = halo;
        coreRef.current = core;

        return () => {
            halo.remove();
            core.remove();
            haloRef.current = null;
            coreRef.current = null;
        };
    }, [map]);

    React.useEffect(() => {
        const unsub = useFlightHoverStore.subscribe((state) => {
            const t = state.hoverTSec;
            const halo = haloRef.current;
            const core = coreRef.current;
            if (!halo || !core) return;

            if (t == null) {
                halo.setStyle({ opacity: 0, fillOpacity: 0 });
                core.setStyle({ opacity: 0, fillOpacity: 0 });
                return;
            }

            const pos = fixIndex.get(t);
            if (!pos) return;

            halo.setLatLng(pos);
            core.setLatLng(pos);
            halo.setStyle({ opacity: 1, fillOpacity: 0.35 });
            core.setStyle({ opacity: 1, fillOpacity: 1 });

            if (!followRef.current) return;

            const now = Date.now();
            if (now - lastPanAtRef.current < 120) return;
            lastPanAtRef.current = now;

            const ll = L.latLng(pos[0], pos[1]);

            const marginPx = 40;
            const b = map.getBounds();
            const nw = map.latLngToContainerPoint(b.getNorthWest());
            const se = map.latLngToContainerPoint(b.getSouthEast());

            const safeNW = L.point(nw.x + marginPx, nw.y + marginPx);
            const safeSE = L.point(se.x - marginPx, se.y - marginPx);

            if (safeSE.x <= safeNW.x || safeSE.y <= safeNW.y) return;

            const safeBounds = L.latLngBounds(
                map.containerPointToLatLng(safeNW),
                map.containerPointToLatLng(safeSE)
            );

            if (!safeBounds.contains(ll)) {
                map.panTo(ll, { animate: true, duration: 0.25 });
            }
        });

        return unsub;
    }, [fixIndex, map]);

    return null;
}

export function FlightMap({
    baseMap = "osm",
    watchKey,
    fixesFull,
    fixesLite,
    followEnabled = true,
}: {
    baseMap?: BaseMap;
    watchKey?: unknown;
    fixesFull: FixPoint[];
    fixesLite: FixPoint[];
    followEnabled: boolean;
}) {
    const hasTrack = fixesFull.length >= 2;
    const initialZoom = hasTrack ? 13 : 11;

    const setWindow = useTimeWindowStore((s) => s.setWindowThrottled);

    const [zoom, setZoom] = React.useState<number>(initialZoom);
    React.useEffect(() => setZoom(initialZoom), [initialZoom]);

    // Meta/geometry always from FULL to prevent "jump"
    const totalSeconds = fixesFull.length ? fixesFull[fixesFull.length - 1].tSec : 0;

    const fullPoints = React.useMemo(() => {
        const out = new Array<LatLngTuple>(fixesFull.length);
        for (let i = 0; i < fixesFull.length; i++) out[i] = [fixesFull[i].lat, fixesFull[i].lon];
        return out;
    }, [fixesFull]);

    // Slider values are seconds; UI label shows %
    const [immediateValue, setImmediateValue] = React.useState<[number, number]>([0, 0]);
    const rangeSec = useThrottledValue<[number, number]>(immediateValue, 150);

    React.useEffect(() => {
        setImmediateValue([0, totalSeconds]);
    }, [totalSeconds]);

    const [startSec, endSec] = React.useMemo(() => {
        const maxSec = totalSeconds;

        const a = clamp(rangeSec[0] ?? 0, 0, maxSec);
        const b = clamp(rangeSec[1] ?? 0, 0, maxSec);

        const start = Math.min(a, b);
        const end = Math.max(a, b);
        return [start, end];
    }, [rangeSec, totalSeconds]);

    React.useEffect(() => {
        setWindow({ startSec, endSec, totalSec: totalSeconds });
    }, [setWindow, startSec, endSec, totalSeconds]);

    // Local drag detection
    const [isWindowDragging, setIsWindowDragging] = React.useState(false);

    const onSliderPointerDown = React.useCallback((e: React.PointerEvent) => {
        setIsWindowDragging(true);
        try {
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        } catch {
            // ignore
        }
    }, []);

    const endDragging = React.useCallback((e?: React.PointerEvent) => {
        setIsWindowDragging(false);
        if (e) {
            try {
                (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
            } catch {
                // ignore
            }
        }
    }, []);

    // For window indices:
    // - In FULL mode (not dragging): we want accurate indices -> compute on fixesFull
    // - In DRAG mode: compute on fixesLite (preview)
    const windowFixes = isWindowDragging ? fixesLite : fixesFull;

    const { startIdx, endIdx } = React.useMemo(() => {
        if (windowFixes.length < 2) return { startIdx: 0, endIdx: 0 };

        const eps = 0.0001;
        let s = startSec;
        let e = endSec;
        if (Math.abs(e - s) < eps) {
            s = 0;
            e = totalSeconds;
        }

        const si = clamp(lowerBoundTSec(windowFixes, s), 0, windowFixes.length - 2);
        const ei = clamp(upperBoundTSec(windowFixes, e), si + 1, windowFixes.length - 1);
        return { startIdx: si, endIdx: ei };
    }, [windowFixes, startSec, endSec, totalSeconds]);

    // LOD preview line (only used during dragging)
    const liteWindowPoints = React.useMemo(() => {
        if (!isWindowDragging) return [];
        if (fixesLite.length < 2) return [];
        const slice = fixesLite.slice(startIdx, endIdx + 1);
        const out = new Array<LatLngTuple>(slice.length);
        for (let i = 0; i < slice.length; i++) out[i] = [slice[i].lat, slice[i].lon];
        return out;
    }, [isWindowDragging, fixesLite, startIdx, endIdx]);

    // Colored chunks (only in FULL mode, and computed on FULL fixes for correct coloring)
    const colorChunks = React.useMemo(() => {
        if (isWindowDragging) return [];
        if (fixesFull.length < 2) return [];
        return buildChunksFromFixesWindow(fixesFull, startIdx, endIdx);
    }, [isWindowDragging, fixesFull, startIdx, endIdx]);

    const center: LatLngTuple = fullPoints.length ? fullPoints[0] : [48.1372, 11.5756];
    const bounds = React.useMemo(() => computeBounds(fullPoints), [fullPoints]);

    const { line, outlineExtra, outlineOpacity } = React.useMemo(() => weightsForZoom(zoom), [zoom]);
    const outlineWeight = line + outlineExtra;
    const OUTLINE = "rgba(0, 0, 0, 0.51)";

    const tile = TILE[baseMap];

    const startPct = pct(startSec, totalSeconds);
    const endPct = pct(endSec, totalSeconds);

    return (
        <Box style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <Group justify="space-between" mb="xs">
                <Text fw={600}>Zeitfenster</Text>
                <Text c="dimmed">
                    {startPct}% ({formatTime(startSec)}) → {endPct}% ({formatTime(endSec)}) / {formatTime(totalSeconds)}
                </Text>
            </Group>

            <Box
                onPointerDown={onSliderPointerDown}
                onPointerUp={endDragging}
                onPointerCancel={endDragging}
                style={{ touchAction: "none" }}
            >
                <RangeSlider
                    value={immediateValue}
                    onChange={(v) => setImmediateValue([Math.min(v[0], v[1]), Math.max(v[0], v[1])])}
                    min={0}
                    max={totalSeconds}
                    step={1}
                    minRange={1}
                    mb="sm"
                    label={(v) => `${pct(v, totalSeconds)}%`}
                />
            </Box>

            <Box style={{ flex: 1, minHeight: 0 }}>
                <MapContainer
                    center={center}
                    zoom={initialZoom}
                    style={{ height: "100%", width: "100%" }}
                    preferCanvas
                >
                    <TileLayer key={tile.key} url={tile.url} attribution={tile.attribution} />

                    {/* Base (faint) full track always (cheap single polyline) */}
                    {fullPoints.length >= 2 && (
                        <Polyline
                            positions={fullPoints}
                            pathOptions={{
                                color: "rgba(120,120,130,0.55)",
                                weight: Math.max(2.2, line * 0.9),
                                opacity: 1,
                                lineCap: "round",
                                lineJoin: "round",
                            }}
                        />
                    )}

                    {/* DRAG MODE: show lite window polyline (no chunks) */}
                    {isWindowDragging && liteWindowPoints.length >= 2 && (
                        <Polyline
                            positions={liteWindowPoints}
                            pathOptions={{
                                color: "rgba(18, 230, 106, 0.95)",
                                weight: Math.max(2.6, line * 1.15),
                                opacity: 1,
                                lineCap: "round",
                                lineJoin: "round",
                            }}
                        />
                    )}

                    {/* FULL MODE: colored chunks (outline + main line) */}
                    {!isWindowDragging &&
                        colorChunks.map((ch, i) => (
                            <Polyline
                                key={`o-${i}`}
                                positions={ch.positions}
                                pathOptions={{
                                    color: OUTLINE,
                                    weight: outlineWeight,
                                    opacity: outlineOpacity,
                                    lineCap: "round",
                                    lineJoin: "round",
                                }}
                            />
                        ))}

                    {!isWindowDragging &&
                        colorChunks.map((ch, i) => (
                            <Polyline
                                key={`c-${i}`}
                                positions={ch.positions}
                                pathOptions={{
                                    color: ch.color,
                                    weight: line,
                                    opacity: 0.98,
                                    lineCap: "round",
                                    lineJoin: "round",
                                }}
                            />
                        ))}

                    {/* Hover marker always precise (full fixes) */}
                    <HoverMarker fixes={fixesFull} followEnabled={followEnabled} />

                    <ZoomWatcher onZoom={setZoom} />
                    <MapAutoResize watchKey={watchKey} />
                    <FitToTrackOnce bounds={bounds} watchKey={watchKey} />
                </MapContainer>
            </Box>
        </Box>
    );
}
