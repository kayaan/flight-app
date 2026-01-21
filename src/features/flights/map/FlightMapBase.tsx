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

    if (h > 0) {
        return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
    }
    return `${m}:${String(r).padStart(2, "0")}`;
}


/**
 * Linie + Halo abhängig vom Zoom, damit beim Rauszoomen nicht "alles weiß" wird.
 */
function weightsForZoom(z: number) {
    // z klein (rausgezoomt) => dickere Linie
    const line = clamp(7.0 - z * 0.45, 2.2, 4.5); // z=9 -> ~3.0, z=12 -> ~2.6, z=15 -> ~2.2
    const shadow = clamp(line + 4.0 - (z - 10) * 0.8, 2.0, 6.5); // z klein => shadow größer
    const shadowOpacity = z <= 11 ? 0.85 : 0.55; // rauszoom: kräftiger
    return { line, shadow, shadowOpacity };
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
    const totalPoints = points.length;
    const hasTrack = totalPoints >= 2;

    const initialZoom = hasTrack ? 13 : 11;
    const [zoom, setZoom] = React.useState<number>(initialZoom);

    const setZoomExplicit = (z: number): void => {
        setZoom(z);
        console.warn(z);
    }

    const totalSeconds = Math.max(0, totalPoints - 1);

    // Zeitfenster als Range in %
    const [rangePct, setRangePct] = React.useState<[number, number]>([0, 100]);

    // Freeze / window-lock
    const [freezeWindow, setFreezeWindow] = React.useState(false);

    // für Freeze-Mode: Position des Fensters (Start in %)
    const [windowStartPct, setWindowStartPct] = React.useState(0);

    // Nur beim EINSCHALTEN initialisieren (sonst ruckelt's)
    React.useEffect(() => {
        if (!freezeWindow) return;
        setWindowStartPct(rangePct[0]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [freezeWindow]);

    // Normalisieren: start <= end
    const [startPctRaw, endPctRaw] = rangePct;
    const startPct = Math.min(startPctRaw, endPctRaw);
    const endPct = Math.max(startPctRaw, endPctRaw);

    // Für Freeze: Breite einfrieren
    const windowWidthPct = Math.max(1, endPct - startPct);

    const effectiveRange: [number, number] = React.useMemo(() => {
        if (!freezeWindow) return [startPct, endPct];

        const maxStart = 100 - windowWidthPct;
        const s = clamp(windowStartPct, 0, maxStart);
        const e = s + windowWidthPct;
        return [s, e];
    }, [freezeWindow, startPct, endPct, windowStartPct, windowWidthPct]);

    // Wenn Freeze aktiv, halte rangePct synchron — aber ohne Update-Loop/Jitter
    React.useEffect(() => {
        if (!freezeWindow) return;

        setRangePct((prev) => {
            if (prev[0] === effectiveRange[0] && prev[1] === effectiveRange[1]) return prev;
            return effectiveRange;
        });
    }, [freezeWindow, effectiveRange]);

    // Sekundenanzeige aus effectiveRange (immer korrekt)
    const startSeconds = Math.floor((effectiveRange[0] / 100) * totalSeconds);
    const endSeconds = Math.floor((effectiveRange[1] / 100) * totalSeconds);

    // Indizes aus effectiveRange
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

    // BUGFIX: vario muss mit startIdx offset gesliced werden (sonst Farben falsch bei start>0)
    const clippedVario = React.useMemo(() => {
        if (!vario) return undefined;
        const segCount = Math.max(0, clippedPoints.length - 1);
        return vario.slice(startIdx, startIdx + segCount);
    }, [vario, startIdx, clippedPoints.length]);



    /**
     * Segmente immer aus POINTS ableiten (points.length-1),
     * vario optional: wenn zu kurz/undefined -> neutral (0).
     */


    const segments = React.useMemo(() => {
        const varioColorStep = (v: number) => {
            const a = Math.abs(v);

            const neutralThreshold = zoom >= 14 ? 0.25 : 0.5;

            if (a < neutralThreshold) return "#60a5fa";

            // 3 Stufen: 1–2, 2–4, >=4
            const level = a < 2 ? 1 : a < 3 ? 2 : 3;

            if (v >= 0) {
                // + (Steigen) — kräftiges Grün
                if (level === 1) return "#4ade80"; // green-400 (hell, gut sichtbar)
                if (level === 2) return "#22c55e"; // green-500
                return "#15803d"; // green-700 (dunkel, sehr kontrastreich)
            } else {
                // - (Sinken) — kräftiges Rot
                if (level === 1) return "#f87171"; // red-400
                if (level === 2) return "#ef4444"; // red-500
                return "#991b1b"; // red-800
            }
        }


        const buildColoredSegments = (points: LatLngTuple[], vario?: number[]): ColoredSegment[] => {
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

        if (clippedPoints.length < 2) return null;
        return buildColoredSegments(clippedPoints, clippedVario);
    }, [clippedPoints, clippedVario, zoom]);

    // fallback center (München)
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

    function getOutlineStyle(zoom: number) {
        // 12 (weit) -> t=0, 15 (nah) -> t=1
        const t = clamp01((zoom - 12) / 3);

        return {
            color: "#61616c",
            extra: Math.round(lerp(1.5, 4.0, t)), // ✅ insgesamt stärker (vorher 1..3)
            opacity: lerp(0.18, 0.72, t),         // ✅ näher: kräftiger, weit: dezent
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
                        <ActionIcon
                            variant="light"
                            onClick={() => setFreezeWindow((v) => !v)}
                            aria-label="Freeze window"
                        >
                            {freezeWindow ? <IconLock size={16} /> : <IconLockOpen size={16} />}
                        </ActionIcon>
                    </Tooltip>
                </Group>
            </Group>

            <RangeSlider
                value={rangePct}
                onChange={(next) => {
                    if (freezeWindow) {
                        // Breite bleibt fix, Block wird verschoben über den Start
                        const width = windowWidthPct;
                        const maxStart = 100 - width;
                        const s = clamp(next[0], 0, maxStart);
                        setWindowStartPct(s);
                        setRangePct([s, s + width]);
                        return;
                    }
                    setRangePct(next);
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
                        onChange={setWindowStartPct}
                        min={0}
                        max={100 - windowWidthPct}
                        step={1}
                        label={(v) => `${v}%`}
                    />
                </Box>
            )}

            <Box style={{ flex: 1, minHeight: 0 }}>
                <MapContainer
                    center={center}
                    zoom={initialZoom}
                    style={{ height: "100%", width: "100%" }}
                    preferCanvas
                >
                    <TileLayer
                        key={tile.key}
                        url={tile.url}
                        attribution={tile.attribution}
                    />

                    {/* Colored route (CLIPPED!) */}
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

                    {/* Fallback */}
                    {!segments && clippedPoints.length >= 2 && <Polyline positions={clippedPoints} />}

                    <ZoomWatcher onZoom={setZoomExplicit} />
                    <MapAutoResize watchKey={watchKey} />
                </MapContainer>
            </Box>
        </Box>
    );
}
