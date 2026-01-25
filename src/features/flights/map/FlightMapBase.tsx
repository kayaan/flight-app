// src/features/flights/map/FlightMapBase.tsx
// Standalone Map component (hover marker updates imperatively via zustand subscribe)
// ✅ Fixes UI jank: no React re-render on hover; no Popup; lightweight circleMarker

import * as React from "react";
import {
    MapContainer,
    TileLayer,
    Polyline,
    useMap,
    useMapEvents,
} from "react-leaflet";
import L, { type LatLngTuple, type LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Box, Group, Text, RangeSlider } from "@mantine/core";
import { useFlightHoverStore } from "../store/flightHover.store";
import { useThrottledValue } from "@mantine/hooks";

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

function buildChunksFromFixesWindow(
    fixes: FixPoint[],
    startIdx: number,
    endIdx: number
): ColorChunk[] {
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

function computeBounds(points: LatLngTuple[]): LatLngBoundsExpression | null {
    if (points.length < 2) return null;
    return points as unknown as LatLngBoundsExpression;
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

    // keep latest toggle without resubscribing
    const followRef = React.useRef<boolean>(followEnabled);
    React.useEffect(() => {
        followRef.current = followEnabled;
    }, [followEnabled]);

    // pan throttling
    const lastPanAtRef = React.useRef(0);

    // create markers once
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

    // subscribe to hoverTSec (no React state!)
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

            // ✅ toggle: only pan when followEnabled
            if (!followRef.current) return;

            // ✅ pan only if not visible (with margin) + rate-limited
            const now = Date.now();
            if (now - lastPanAtRef.current < 120) return;
            lastPanAtRef.current = now;

            const ll = L.latLng(pos[0], pos[1]);

            // safe viewport margin in pixels
            const marginPx = 40;
            const b = map.getBounds();
            const nw = map.latLngToContainerPoint(b.getNorthWest());
            const se = map.latLngToContainerPoint(b.getSouthEast());

            const safeNW = L.point(nw.x + marginPx, nw.y + marginPx);
            const safeSE = L.point(se.x - marginPx, se.y - marginPx);

            // avoid degenerate bounds
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
    fixes,
    followEnabled = true
}: {
    baseMap?: BaseMap;
    watchKey?: unknown;
    fixes: FixPoint[];
    followEnabled: boolean
}) {
    const hasTrack = fixes.length >= 2;
    const initialZoom = hasTrack ? 13 : 11;

    const [zoom, setZoom] = React.useState<number>(initialZoom);
    React.useEffect(() => setZoom(initialZoom), [initialZoom]);

    // internal range selection (decoupled from outside)


    const [immediateValue, setImmediateValue] = React.useState<[number, number]>([0, 100]);
    const rangePct = useThrottledValue<[number, number]>(immediateValue, 100);

    const fullPoints = React.useMemo(() => {
        const out = new Array<LatLngTuple>(fixes.length);
        for (let i = 0; i < fixes.length; i++) out[i] = [fixes[i].lat, fixes[i].lon];
        return out;
    }, [fixes]);

    const totalSeconds = fixes.length ? fixes[fixes.length - 1].tSec : 0;

    const [startSec, endSec] = React.useMemo(() => {
        const a = clamp(rangePct[0], 0, fixes.at(-1)!.tSec);
        const b = clamp(rangePct[1], 0, fixes.at(-1)!.tSec);
        const start = Math.min(a, b);
        const end = Math.max(a, b);
        return [start, end];
    }, [rangePct, fixes]);

    const { startIdx, endIdx } = React.useMemo(() => {
        if (fixes.length < 2) return { startIdx: 0, endIdx: 0 };
        const s = clamp(lowerBoundTSec(fixes, startSec), 0, fixes.length - 2);
        const e = clamp(upperBoundTSec(fixes, endSec), s + 1, fixes.length - 1);
        return { startIdx: s, endIdx: e };
    }, [fixes, startSec, endSec]);

    const colorChunks = React.useMemo(() => {
        if (!hasTrack) return [];
        return buildChunksFromFixesWindow(fixes, startIdx, endIdx);
    }, [hasTrack, fixes, startIdx, endIdx]);

    const center: LatLngTuple = fullPoints.length ? fullPoints[0] : [48.1372, 11.5756];
    const bounds = React.useMemo(() => computeBounds(fullPoints), [fullPoints]);

    const { line, outlineExtra, outlineOpacity } = React.useMemo(() => weightsForZoom(zoom), [zoom]);
    const outlineWeight = line + outlineExtra;
    const OUTLINE = "rgba(0, 0, 0, 0.51)";

    const tile = TILE[baseMap];

    return (
        <Box style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <Group justify="space-between" mb="xs">
                <Text fw={600}>Zeitfenster</Text>
                <Text c="dimmed">
                    {formatTime(startSec)} → {formatTime(endSec)} / {formatTime(totalSeconds)}
                </Text>
            </Group>

            <RangeSlider
                onChange={(v) => setImmediateValue([Math.min(v[0], v[1]), Math.max(v[0], v[1])])}
                min={0}
                max={fixes.at(-1)?.tSec}
                step={1}
                minRange={1}
                mb="sm"
            />

            <Box style={{ flex: 1, minHeight: 0 }}>
                <MapContainer
                    center={center}
                    zoom={initialZoom}
                    style={{ height: "100%", width: "100%" }}
                    preferCanvas
                >
                    <TileLayer key={tile.key} url={tile.url} attribution={tile.attribution} />

                    {/* Base (faint) track */}
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

                    {/* ✅ Hover marker (imperative, no React re-render on hover) */}
                    <HoverMarker fixes={fixes} followEnabled={followEnabled} />

                    {/* Colored chunks: outline + main line */}
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
                            }}
                        />
                    ))}

                    <ZoomWatcher onZoom={setZoom} />
                    <MapAutoResize watchKey={watchKey} />
                    <FitToTrackOnce bounds={bounds} watchKey={watchKey} />
                </MapContainer>
            </Box>
        </Box>
    );
}
