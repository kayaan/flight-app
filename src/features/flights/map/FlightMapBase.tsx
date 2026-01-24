// src/features/flights/map/FlightMapBase.tsx
// Standalone Map component (no imperative handle, no coupling to flights.$id.tsx)

import * as React from "react";
import { MapContainer, TileLayer, Polyline, useMap, useMapEvents, Marker, Popup } from "react-leaflet";
import { type LatLngTuple, type LatLngBoundsExpression, } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Box, Group, Text, RangeSlider } from "@mantine/core";
import { useFlightHoverStore } from "../store/flightHover.store";

import type { Marker as LeafletMarker } from "leaflet";
import L from "leaflet";

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
    if (a < 0.5) return "#60a5fa";

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

function computeBounds(points: LatLngTuple[]): LatLngBoundsExpression | null {
    if (points.length < 2) return null;
    return points as unknown as LatLngBoundsExpression;
}

function AutoPan({ pos }: { pos: { lat: number; lon: number } | null }) {
    const map = useMap();

    React.useEffect(() => {
        if (!pos) return;
        const ll: [number, number] = [pos.lat, pos.lon];

        if (!map.getBounds().contains(ll)) {
            map.panTo(ll, { animate: true, duration: 0.25 });
        }
    }, [pos, map]);

    return null;
}

export function FlightMap({
    baseMap = "osm",
    watchKey,
    fixes,
}: {
    baseMap?: BaseMap;
    watchKey?: unknown;
    fixes: FixPoint[];
}) {
    const hasTrack = fixes.length >= 2;
    const initialZoom = hasTrack ? 13 : 11;

    const hoverTSec = useFlightHoverStore(s => s.hoverTSec);

    const fixByTSecRef = React.useRef<Map<number, { lat: number; lon: number }>>(new Map());

    React.useEffect(() => {
        const m = new Map<number, { lat: number; lon: number }>();
        for (const f of fixes) {
            m.set(Math.round(f.tSec), { lat: f.lat, lon: f.lon });
        }
        fixByTSecRef.current = m;
    }, [fixes]);

    const [hoverPos, setHoverPos] = React.useState<{ lat: number; lon: number } | null>(null);

    React.useEffect(() => {
        if (hoverTSec == null) {
            setHoverPos(null);
            return;
        }

        const pos = fixByTSecRef.current.get(hoverTSec);
        if (pos) {
            setHoverPos(pos);
        }
    }, [hoverTSec]);

    const [zoom, setZoom] = React.useState<number>(initialZoom);
    React.useEffect(() => setZoom(initialZoom), [initialZoom]);

    // internal range selection (decoupled from outside)
    const [rangePct, setRangePct] = React.useState<[number, number]>([0, 100]);

    const fullPoints = React.useMemo(() => {
        const out = new Array<LatLngTuple>(fixes.length);
        for (let i = 0; i < fixes.length; i++) out[i] = [fixes[i].lat, fixes[i].lon];
        return out;
    }, [fixes]);

    const totalSeconds = fixes.length ? fixes[fixes.length - 1].tSec : 0;

    const [startSec, endSec] = React.useMemo(() => {
        const a = clamp(rangePct[0], 0, 100);
        const b = clamp(rangePct[1], 0, 100);
        const start = (Math.min(a, b) / 100) * totalSeconds;
        const end = (Math.max(a, b) / 100) * totalSeconds;
        return [start, end];
    }, [rangePct, totalSeconds]);

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
    const OUTLINE = "rgba(20,20,25,0.45)";

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
                value={rangePct}
                onChange={(v) => setRangePct([Math.min(v[0], v[1]), Math.max(v[0], v[1])])}
                min={0}
                max={100}
                step={1}
                minRange={1}
                mb="sm"
            />

            <Box style={{ flex: 1, minHeight: 0 }}>
                <MapContainer center={center} zoom={initialZoom} style={{ height: "100%", width: "100%" }} preferCanvas>

                    {/* <AutoPan pos={hoverPos} /> */}

                    <TileLayer key={tile.key} url={tile.url} attribution={tile.attribution} />

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

                    {hoverPos && (
                        <Marker position={[hoverPos.lat, hoverPos.lon]}>
                            <Popup>
                                t = {hoverTSec}s
                            </Popup>
                        </Marker>
                    )}

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
