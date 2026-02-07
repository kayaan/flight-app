// src/features/flights/map/FlightMapBase.tsx
// Standalone Map component (hover marker updates imperatively via zustand subscribe)
// ✅ Fixes UI jank: no React re-render on hover; no Popup; lightweight circleMarker
// ✅ Fixes disappearing route while dragging: active track is now an imperative Leaflet polyline layer

import * as React from "react";
import L, { type LatLngTuple, type LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Box, Group, Text, RangeSlider } from "@mantine/core";
import { useFlightHoverStore } from "../store/flightHover.store";
import { useTimeWindowStore, type TimeWindow } from "../store/timeWindow.store";

import { MapContainer, TileLayer, Polyline, useMap, useMapEvents } from "react-leaflet";

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

function FitToWindowOnCommit({
    bounds,
    commitKey,
    enabled,
}: {
    bounds: LatLngBoundsExpression | null;
    commitKey: string;
    enabled: boolean;
}) {
    const map = useMap();
    const lastKeyRef = React.useRef<string>("");

    const autoFitSelection = useTimeWindowStore((s) => s.autoFitSelection); // ✅

    React.useEffect(() => {
        if (!enabled) return;
        if (!autoFitSelection) return; // ✅ HIER ist die Logik „nicht zoomen“
        if (!bounds) return;

        if (lastKeyRef.current === commitKey) return;
        lastKeyRef.current = commitKey;

        map.fitBounds(bounds, { padding: [18, 18] });
    }, [map, bounds, commitKey, enabled, autoFitSelection]);

    return null;
}


function FitToSelectionOrFull({
    fullBounds,
    windowBounds,
    win,
    isDragging,
    watchKey,
}: {
    fullBounds: LatLngBoundsExpression | null;
    windowBounds: LatLngBoundsExpression | null;
    win: TimeWindow | null;
    isDragging: boolean;
    watchKey?: unknown;
}) {
    const map = useMap();
    const lastKeyRef = React.useRef<string>("");

    const autoFitSelection = useTimeWindowStore((s) => s.autoFitSelection); // ✅

    React.useEffect(() => {
        if (isDragging) return;

        // ✅ WICHTIG: nur Selection-Fit blocken, Full-Fit (Reset) erlauben
        if (win && !autoFitSelection) return;

        const targetBounds = win ? windowBounds : fullBounds;
        if (!targetBounds) return;

        const key = win
            ? `win:${Math.round(win.startSec)}-${Math.round(win.endSec)}:${String(watchKey ?? "")}`
            : `full:${String(watchKey ?? "")}`;

        if (lastKeyRef.current === key) return;
        lastKeyRef.current = key;

        map.fitBounds(targetBounds, { padding: [18, 18] });
    }, [map, fullBounds, windowBounds, win, isDragging, watchKey, autoFitSelection]);

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

function sliceFixesByWindow(fixes: FixPoint[], startSec: number, endSec: number) {
    if (fixes.length < 2) return [];
    const s = clamp(lowerBoundTSec(fixes, startSec), 0, fixes.length - 2);
    const e = clamp(upperBoundTSec(fixes, endSec), s + 1, fixes.length - 1);

    const out: LatLngTuple[] = [];
    for (let i = s; i <= e; i++) {
        const { lat, lon } = fixes[i];
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (lat === 0 && lon === 0) continue;
        out.push([lat, lon]);
    }
    return out;
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

function ensurePane(map: L.Map, name: string, zIndex: number) {
    const existing = map.getPane(name);
    if (existing) return existing;
    const pane = map.createPane(name);
    pane.style.zIndex = String(zIndex);
    return pane;
}

/**
 * ✅ Active faint base track (full/lite) as imperative Leaflet layer.
 */
function ActiveTrackLayer({
    points,
    weight,
    paneName,
    watchKey,
    color = "rgba(120,120,130,0.55)",
    opacity = 1,
}: {
    points: LatLngTuple[];
    weight: number;
    paneName: string;
    watchKey?: unknown;
    color?: string;
    opacity?: number;
}) {
    const map = useMap();
    const lineRef = React.useRef<L.Polyline | null>(null);

    React.useEffect(() => {
        ensurePane(map, paneName, 650);

        if (lineRef.current) return;

        const line = L.polyline(points, {
            pane: paneName,
            color,
            weight,
            opacity,
            lineCap: "round",
            lineJoin: "round",
            interactive: false,
        });

        line.addTo(map);
        lineRef.current = line;

        return () => {
            line.remove();
            lineRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [map]);

    React.useEffect(() => {
        const line = lineRef.current;
        if (!line) return;
        line.setLatLngs(points && points.length >= 2 ? points : []);
        line.redraw?.();
    }, [points]);

    React.useEffect(() => {
        const line = lineRef.current;
        if (!line) return;
        line.setStyle({ weight, color, opacity });
        line.redraw?.();
    }, [weight, color, opacity]);

    React.useEffect(() => {
        const line = lineRef.current;
        if (!line) return;
        line.setLatLngs(points && points.length >= 2 ? points : []);
        line.redraw?.();
    }, [watchKey, points]);

    return null;
}

/**
 * ✅ Imperative hover marker
 */
function HoverMarker({ fixes, followEnabled }: { fixes: FixPoint[]; followEnabled: boolean }) {
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

            const safeBounds = L.latLngBounds(map.containerPointToLatLng(safeNW), map.containerPointToLatLng(safeSE));

            if (!safeBounds.contains(ll)) {
                map.panTo(ll, { animate: true, duration: 0.25 });
            }
        });

        return unsub;
    }, [fixIndex, map]);

    return null;
}

function dragStyleForZoomTopoGlow(z: number) {
    const t = clamp((z - 10) / 6, 0, 1);

    const coreWeight = 7.0 - t * 3.5;
    const coreColor = "rgba(0, 255, 200, 0.95)";

    const outlineWeight = coreWeight + 3.5;
    const outlineColor = "rgba(0, 0, 0, 0.9)";

    const glowWeight = outlineWeight + 6;
    const glowColor = "rgba(0, 255, 200, 0.25)";

    return {
        glow: { weight: glowWeight, color: glowColor, opacity: 1 },
        outline: { weight: outlineWeight, color: outlineColor, opacity: 1 },
        core: { weight: coreWeight, color: coreColor, opacity: 1 },
    };
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

    const win = useTimeWindowStore((s) => s.window);
    const setWindowThrottled = useTimeWindowStore((s) => s.setWindowThrottled);
    const setWindow = useTimeWindowStore((s) => s.setWindow);
    const isDragging = useTimeWindowStore((s) => s.isDragging);
    const setDragging = useTimeWindowStore((s) => s.setDragging);
    const storeDragging = useTimeWindowStore((s) => s.isDragging);


    const windowPoints = React.useMemo(() => {
        if (!win) return null;
        const src = fixesLite && fixesLite.length >= 2 ? fixesLite : fixesFull;
        const pts = sliceFixesByWindow(src, win.startSec, win.endSec);
        return pts.length >= 2 ? pts : null;
    }, [win, fixesLite, fixesFull, sliceFixesByWindow]);

    const windowBounds = React.useMemo(() => {
        if (!win) return null;
        const src = fixesLite && fixesLite.length >= 2 ? fixesLite : fixesFull;
        const pts = sliceFixesByWindow(src, win.startSec, win.endSec);
        return pts.length >= 2 ? computeBounds(pts) : null;
    }, [win, fixesLite, fixesFull, sliceFixesByWindow]);

    const [zoom, setZoom] = React.useState<number>(initialZoom);
    React.useEffect(() => setZoom(initialZoom), [initialZoom]);

    const fullPoints = React.useMemo(() => {
        const out = new Array<LatLngTuple>(fixesFull.length);
        for (let i = 0; i < fixesFull.length; i++) out[i] = [fixesFull[i].lat, fixesFull[i].lon];
        return out;
    }, [fixesFull]);

    const baseFullPoints = fullPoints;

    const totalSeconds = fixesFull.length ? fixesFull[fixesFull.length - 1].tSec : 0;

    // ✅ window is Source-of-Truth (from store), fallback to full range
    const startSec = win?.startSec ?? 0;
    const endSec = win?.endSec ?? totalSeconds;

    const dragWindowPoints = React.useMemo(() => {
        if (!isDragging) return [];
        const src = fixesLite && fixesLite.length >= 2 ? fixesLite : fixesFull;
        return sliceFixesByWindow(src, startSec, endSec);
    }, [isDragging, fixesLite, fixesFull, startSec, endSec]);

    const { startIdx, endIdx } = React.useMemo(() => {
        if (fixesFull.length < 2) return { startIdx: 0, endIdx: 0 };
        const s = clamp(lowerBoundTSec(fixesFull, startSec), 0, fixesFull.length - 2);
        const e = clamp(upperBoundTSec(fixesFull, endSec), s + 1, fixesFull.length - 1);
        return { startIdx: s, endIdx: e };
    }, [fixesFull, startSec, endSec]);

    const colorChunks = React.useMemo(() => {
        if (!hasTrack) return [];
        if (isDragging) return [];
        return buildChunksFromFixesWindow(fixesFull, startIdx, endIdx);
    }, [hasTrack, isDragging, fixesFull, startIdx, endIdx]);

    const center: LatLngTuple = fullPoints.length ? fullPoints[0] : [48.1372, 11.5756];
    const bounds = React.useMemo(() => computeBounds(fullPoints), [fullPoints]);



    const { line, outlineExtra, outlineOpacity } = React.useMemo(() => weightsForZoom(zoom), [zoom]);
    const dragStyle = React.useMemo(() => dragStyleForZoomTopoGlow(zoom), [zoom]);

    const outlineWeight = line + outlineExtra;
    const OUTLINE = "rgba(0, 0, 0, 0.51)";

    const tile = TILE[baseMap];

    const startPct = pct(startSec, totalSeconds);
    const endPct = pct(endSec, totalSeconds);

    const autoFitSelection = useTimeWindowStore((s) => s.autoFitSelection);


    return (
        <Box style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <Group justify="space-between" mb="xs">
                <Text fw={600}>Zeitfenster</Text>
                <Text c="dimmed">
                    {startPct}% ({formatTime(startSec)}) → {endPct}% ({formatTime(endSec)}) / {formatTime(totalSeconds)}
                </Text>
            </Group>

            {/* ✅ Slider is bound to Store window, and sets Store dragging */}
            <RangeSlider
                value={[startSec, endSec]}
                onChange={(v) => {
                    const a = Math.min(v[0], v[1]);
                    const b = Math.max(v[0], v[1]);

                    setDragging(true);

                    setWindowThrottled({
                        startSec: a,
                        endSec: b,
                        totalSec: totalSeconds,
                    });
                }}
                onChangeEnd={(v) => {
                    const a = Math.min(v[0], v[1]);
                    const b = Math.max(v[0], v[1]);

                    setWindow({
                        startSec: a,
                        endSec: b,
                        totalSec: totalSeconds,
                    });

                    setDragging(false);
                }}
                min={0}
                max={totalSeconds}
                step={1}
                minRange={1}
                mb="sm"
                label={(v) => `${pct(v, totalSeconds)}%`}
            />

            <Box style={{ flex: 1, minHeight: 0 }}>
                <MapContainer center={center} zoom={initialZoom} style={{ height: "100%", width: "100%" }} preferCanvas>
                    <TileLayer key={tile.key} url={tile.url} attribution={tile.attribution} />

                    {/* ✅ Base track full imperatively */}
                    <ActiveTrackLayer
                        paneName="trackBase"
                        points={baseFullPoints}
                        weight={Math.max(2.2, line * 0.9)}
                        watchKey={watchKey}
                        color="rgba(120,120,130,0.55)"
                        opacity={1}
                    />

                    {/* While dragging: show lite window overlay */}
                    {isDragging && (
                        <>
                            <ActiveTrackLayer
                                paneName="trackDrag"
                                points={dragWindowPoints}
                                watchKey={`${String(watchKey ?? "flight")}-drag-glow`}
                                {...dragStyle.glow}
                            />
                            <ActiveTrackLayer
                                paneName="trackDrag"
                                points={dragWindowPoints}
                                watchKey={`${String(watchKey ?? "flight")}-drag-outline`}
                                {...dragStyle.outline}
                            />
                            <ActiveTrackLayer
                                paneName="trackDrag"
                                points={dragWindowPoints}
                                watchKey={`${String(watchKey ?? "flight")}-drag-core`}
                                {...dragStyle.core}
                            />
                        </>
                    )}

                    {/* ✅ Hover marker stays FULL */}
                    <HoverMarker fixes={fixesFull} followEnabled={followEnabled} />

                    {/* Colored chunks only when NOT dragging */}
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
                    {/* <FitToTrackOnce bounds={bounds} watchKey={watchKey} /> */}
                    <FitToWindowOnCommit
                        bounds={windowBounds}
                        enabled={!!win && !storeDragging}
                        commitKey={
                            win
                                ? `${Math.round(win.startSec)}-${Math.round(win.endSec)}-${String(watchKey ?? "")}`
                                : `none-${String(watchKey ?? "")}`
                        }
                    />
                    <FitToSelectionOrFull
                        fullBounds={bounds}
                        windowBounds={windowBounds}
                        win={win}
                        isDragging={storeDragging}
                        watchKey={watchKey}
                    />
                </MapContainer>
            </Box>
        </Box>
    );
}
