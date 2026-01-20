import * as React from "react";
import { MapContainer, TileLayer, Polyline, useMap, useMapEvents } from "react-leaflet";
import type { LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Box, Group, Slider, Text } from "@mantine/core";

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

    if (h > 0) {
        return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
    }
    return `${m}:${String(r).padStart(2, "0")}`;
}


function varioColorStep(v: number) {
    const a = Math.abs(v);

    // Neutralzone
    if (a < 1) return "rgba(60,60,60,0.5)"; // halbtransparentes Grau

    // 3 Stufen: 1–2, 2–4, >=4
    const level = a < 2 ? 1 : a < 4 ? 2 : 3;

    if (v >= 0) {
        // + (Steigen) — kräftiges Grün
        if (level === 1) return "#4ade80"; // green-400 (hell, gut sichtbar)
        if (level === 2) return "#22c55e"; // green-500
        return "#15803d";                 // green-700 (dunkel, sehr kontrastreich)
    } else {
        // - (Sinken) — kräftiges Rot
        if (level === 1) return "#f87171"; // red-400
        if (level === 2) return "#ef4444"; // red-500
        return "#991b1b";                 // red-800
    }
}

/**
 * Linie + Halo abhängig vom Zoom, damit beim Rauszoomen nicht "alles weiß" wird.
 */
function weightsForZoom(z: number) {
    // z klein (rausgezoomt) => dickere Linie
    const line = clamp(7.0 - z * 0.45, 2.2, 4.5);      // z=9 -> ~3.0, z=12 -> ~2.6, z=15 -> ~2.2
    const shadow = clamp(line + 4.0 - (z - 10) * 0.8, 2.0, 6.5); // z klein => shadow größer
    const shadowOpacity = z <= 11 ? 0.85 : 0.55;       // rauszoom: kräftiger
    return { line, shadow, shadowOpacity };
}

/**
 * Segmente immer aus POINTS ableiten (points.length-1),
 * vario optional: wenn zu kurz/undefined -> neutral (0).
 */
function buildColoredSegments(points: LatLngTuple[], vario?: number[]): ColoredSegment[] {
    const out: ColoredSegment[] = [];
    if (points.length < 2) return out;

    const n = points.length - 1;
    for (let i = 0; i < n; i++) {
        const v = vario?.[i] ?? 0;
        out.push({
            positions: [points[i], points[i + 1]],
            color: varioColorStep(v),
        });
    }
    return out;
}

/**
 * Invalidates map size on open/resize (splitter, panels, etc.)
 */
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

/**
 * Reads Leaflet zoom level and reports it upward.
 * MUST be rendered inside <MapContainer>.
 */
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
}: {
    points: LatLngTuple[];
    vario?: number[];
    watchKey?: unknown;
    baseMap?: BaseMap;
}) {
    const hasTrack = points.length >= 2;

    const [routePct, setRoutePct] = React.useState(100);
    const total = points.length;

    // 0..100% => 0..total Punkte
    const clippedPoints = React.useMemo(() => {
        if (total === 0) return [];
        const endIndex = clamp(
            Math.floor((routePct / 100) * (total - 1)),
            0,
            total - 1
        );
        return points.slice(0, endIndex + 1);
    }, [routePct, total, points]);

    // vario passt zu Segmenten (points-1). Wenn wir Punkte clippen, brauchen wir vario bis (clippedPoints.length-1)
    const clippedVario = React.useMemo(() => {
        if (!vario) return undefined;
        const segCount = Math.max(0, clippedPoints.length - 1);
        return vario.slice(0, segCount);
    }, [vario, clippedPoints.length]);

    const segments = React.useMemo(() => {
        if (clippedPoints.length < 2) return null;
        return buildColoredSegments(clippedPoints, clippedVario);
    }, [clippedPoints, clippedVario]);

    // fallback center (München)
    const fallbackCenter: LatLngTuple = [48.1372, 11.5756];
    const center = clippedPoints.length > 0 ? clippedPoints[0] : (hasTrack ? points[0] : fallbackCenter);

    const initialZoom = hasTrack ? 13 : 11;
    const [zoom, setZoom] = React.useState<number>(initialZoom);

    React.useEffect(() => {
        setZoom(initialZoom);
    }, [initialZoom]);

    const { line } = React.useMemo(() => weightsForZoom(zoom), [zoom]);
    const tile = TILE[baseMap];


    const totalSeconds = Math.max(0, points.length - 1);

    const currentSeconds = React.useMemo(() => {
        return Math.floor((routePct / 100) * totalSeconds);
    }, [routePct, totalSeconds]);


    return (
        <Box style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <Group justify="space-between" mb="xs">
                <Text fw={600}>Route</Text>
                <Text c="dimmed">
                    {formatTime(currentSeconds)} / {formatTime(totalSeconds)}
                </Text>
            </Group>

            <Slider
                value={routePct}
                onChange={setRoutePct}
                min={0}
                max={100}
                step={1}
                label={(v) => `${v}%`}
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

                    {/* Colored route (CLIPPED!) */}
                    {segments?.map((seg, i) => (
                        <Polyline
                            key={i}
                            positions={seg.positions}
                            pathOptions={{
                                color: seg.color,
                                weight: line,
                                opacity: 0.98,
                            }}
                        />
                    ))}

                    {/* Fallback, falls du mal ohne Segmente rendern willst */}
                    {!segments && clippedPoints.length >= 2 && <Polyline positions={clippedPoints} />}

                    <ZoomWatcher onZoom={setZoom} />
                    <MapAutoResize watchKey={watchKey} />
                </MapContainer>
            </Box>
        </Box>
    );
}