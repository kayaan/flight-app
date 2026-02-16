// src/features/flights/map/FlightMapBase.tsx
// Standalone Map component (hover marker updates imperatively via zustand subscribe)
// ✅ Fixes UI jank: no React re-render on hover; no Popup; lightweight circleMarker
// ✅ Fixes disappearing route while dragging: active track is now an imperative Leaflet polyline layer
// ✅ Hover marker ALWAYS in foreground (own pane + bringToFront)

import * as React from "react";
import L, { type LatLngTuple, type LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Box, Group, Text, RangeSlider } from "@mantine/core";
import { useFlightHoverStore } from "../store/flightHover.store";
import { useTimeWindowStore, type TimeWindow } from "../store/timeWindow.store";

import { MapContainer, TileLayer, Polyline, useMap, useMapEvents } from "react-leaflet";
import { useWindConfigStore } from "../analysis/wind/wind.config.store";
import { useWindEstimate } from "../analysis/wind/useWindEstimate";
import { WindLayer } from "./layers/windLayer";
import type { FixPoint } from "../igc";
import { ThermalCirclesLayer } from "./layers/ThermalCirclesLayer";
import { useFlightDetailsUiStore } from "../store/flightDetailsUi.store";
import type { ThermalCircle } from "../analysis/turns/detectThermalCircles";

export type BaseMap = "osm" | "topo";

const FOLLOW_MAX_ZOOM = 14; // wenn Follow an: nicht näher als das
const FOLLOW_FIT_PADDING = 60; // px padding beim fitBounds

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
    const outlineOpacity = clamp(0.2 + (z - 12) * 0.15, 0.2, 0.75);
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


// --- delete these two components entirely ---
// function FitToWindowOnCommit(...) { ... }
// function FitToSelectionOrFull(...) { ... }

// ✅ single source of truth: ONE fitBounds controller
function FitBoundsController({
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

    const autoFitSelection = useTimeWindowStore((s) => s.autoFitSelection);

    // prevent double fit for the same logical trigger
    const lastKeyRef = React.useRef<string>("");

    // optional: tiny debounce so multiple state updates in one tick don't cause extra work
    const tRef = React.useRef<number | null>(null);

    React.useEffect(() => {
        if (isDragging) return;

        // Decide what we want to fit to:
        // - If win exists: only fit if autoFitSelection is enabled
        // - Else: fit to full bounds (e.g. reset or initial)
        const targetBounds = win ? windowBounds : fullBounds;
        if (!targetBounds) return;

        if (win && !autoFitSelection) {
            // user has selection, but auto-fit disabled => don't move map
            return;
        }

        // Build a stable "reason key" that changes ONLY when we truly want to refit.
        // - For window: depends on committed window values
        // - For full: depends on watchKey (flight/map base change), not on UI toggles
        const key = win
            ? `win:${Math.round(win.startSec)}-${Math.round(win.endSec)}`
            : `full:${String(watchKey ?? "")}`;

        if (lastKeyRef.current === key) return;
        lastKeyRef.current = key;

        // Debounce (optional but helps perceived snappiness when multiple setStates happen)
        if (tRef.current != null) window.clearTimeout(tRef.current);

        tRef.current = window.setTimeout(() => {
            tRef.current = null;

            // ✅ Skip if the map already "basically" contains the target.
            // This avoids pointless fitBounds calls when bounds didn't materially change.
            try {
                const current = map.getBounds();
                const target = L.latLngBounds(targetBounds as any);

                // inflate a tiny bit so we don't refit for minuscule differences
                const inflated = current.pad(-0.02); // negative shrinks (stricter). use +0.02 to loosen.
                const alreadyOk = inflated.isValid() && target.isValid() && inflated.contains(target);

                if (alreadyOk) return;
            } catch {
                // ignore and fit anyway
            }

            // ✅ For auto/system fits: keep it non-animated (much cheaper and feels snappier)
            map.fitBounds(targetBounds, { padding: [18, 18], animate: false });
        }, 80);

        return () => {
            if (tRef.current != null) window.clearTimeout(tRef.current);
            tRef.current = null;
        };
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
        // base track high-ish, but BELOW hover marker
        ensurePane(map, paneName, paneName === "trackDrag" ? 820 : 650);

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

type ChunkRange = { color: string; fromIdx: number; toIdx: number };
// fromIdx..toIdx sind POINT-indizes (inkl.), toIdx >= fromIdx+1

function ColorChunkRangesLayer({
    latlngs,
    ranges,
    outlineWeight,
    outlineOpacity,
    line,
    paneName = "trackColor",
}: {
    latlngs: LatLngTuple[];
    ranges: ChunkRange[];
    outlineWeight: number;
    outlineOpacity: number;
    line: number;
    paneName?: string;
}) {
    const map = useMap();

    const groupRef = React.useRef<L.LayerGroup | null>(null);
    const outlineRef = React.useRef<L.Polyline[]>([]);
    const coreRef = React.useRef<L.Polyline[]>([]);

    // ✅ pooled arrays for setLatLngs (avoid allocating new arrays every update)
    const ptsPoolRef = React.useRef<LatLngTuple[][]>([]);

    React.useEffect(() => {
        ensurePane(map, paneName, 700);

        const g = L.layerGroup([], { pane: paneName } as any);
        g.addTo(map);
        groupRef.current = g;

        return () => {
            g.remove();
            groupRef.current = null;
            outlineRef.current = [];
            coreRef.current = [];
            ptsPoolRef.current = [];
        };
    }, [map, paneName]);

    React.useEffect(() => {
        const g = groupRef.current;
        if (!g) return;

        const OUTLINE = "rgba(0, 0, 0, 0.51)";

        const ensurePoly = (arr: L.Polyline[], i: number, color: string, weight: number, opacity: number) => {
            let p = arr[i];
            if (!p) {
                p = L.polyline([], {
                    pane: paneName,
                    color,
                    weight,
                    opacity,
                    lineCap: "round",
                    lineJoin: "round",
                    interactive: false,
                });
                p.addTo(g);
                arr[i] = p;
            } else {
                p.setStyle({ color, weight, opacity });
            }
            return p;
        };

        const ensurePts = (i: number) => {
            let pts = ptsPoolRef.current[i];
            if (!pts) {
                pts = [];
                ptsPoolRef.current[i] = pts;
            }
            return pts;
        };

        // --- update / create ---
        for (let i = 0; i < ranges.length; i++) {
            const r = ranges[i];

            const o = ensurePoly(outlineRef.current, i, OUTLINE, outlineWeight, outlineOpacity);
            const c = ensurePoly(coreRef.current, i, r.color, line, 0.98);

            const pts = ensurePts(i);
            pts.length = 0;

            // fill pooled array with references to precomputed tuples
            const from = Math.max(0, Math.min(r.fromIdx, latlngs.length - 1));
            const to = Math.max(0, Math.min(r.toIdx, latlngs.length - 1));

            for (let k = from; k <= to; k++) pts.push(latlngs[k]);

            o.setLatLngs(pts);
            c.setLatLngs(pts);
        }

        // --- remove extras ---
        for (let i = ranges.length; i < outlineRef.current.length; i++) outlineRef.current[i]?.remove();
        outlineRef.current.length = ranges.length;

        for (let i = ranges.length; i < coreRef.current.length; i++) coreRef.current[i]?.remove();
        coreRef.current.length = ranges.length;

        // keep pool arrays; we can keep them to reuse later (optional)
        // ptsPoolRef.current.length = Math.max(ptsPoolRef.current.length, ranges.length);
    }, [latlngs, ranges, outlineWeight, outlineOpacity, line, paneName]);

    return null;
}

function HoverMarker({ fixes, followEnabled }: { fixes: FixPoint[]; followEnabled: boolean }) {
    const map = useMap();

    const coreRef = React.useRef<L.CircleMarker | null>(null);
    const haloRef = React.useRef<L.CircleMarker | null>(null);

    // follow flag as ref (unchanged)
    const followRef = React.useRef<boolean>(followEnabled);
    React.useEffect(() => {
        followRef.current = followEnabled;
    }, [followEnabled]);

    const lastPanAtRef = React.useRef(0);

    // ✅ Smooth animation refs (marker)
    const targetRef = React.useRef<LatLngTuple | null>(null);
    const currentRef = React.useRef<LatLngTuple | null>(null);
    const rafRef = React.useRef<number | null>(null);

    // ✅ Smooth animation refs (map follow)
    const mapTargetCenterRef = React.useRef<L.LatLng | null>(null);
    const mapCurrentCenterRef = React.useRef<L.LatLng | null>(null);

    React.useEffect(() => {
        const stopFollow = () => {
            mapTargetCenterRef.current = null;
            mapCurrentCenterRef.current = null;
        };

        map.on("dragstart", stopFollow);
        map.on("zoomstart", stopFollow);

        return () => {
            map.off("dragstart", stopFollow);
            map.off("zoomstart", stopFollow);
        };
    }, [map]);

    // --- helpers ---
    const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    // smoothing factors
    const MARKER_K = 0.18;
    const MAP_K = 0.12;

    // ✅ Find interpolated position for arbitrary tSec
    const positionAt = React.useCallback(
        (tSec: number): LatLngTuple | null => {
            const n = fixes.length;
            if (n < 2) return null;

            // clamp to ends
            if (tSec <= fixes[0].tSec) return [fixes[0].lat, fixes[0].lon];
            if (tSec >= fixes[n - 1].tSec) return [fixes[n - 1].lat, fixes[n - 1].lon];

            // binary search: find i such that fixes[i].tSec <= t < fixes[i+1].tSec
            let lo = 0;
            let hi = n - 1;
            while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                if (fixes[mid].tSec <= tSec) lo = mid;
                else hi = mid - 1;
            }
            const i = Math.min(lo, n - 2);
            const a = fixes[i];
            const b = fixes[i + 1];

            const dt = b.tSec - a.tSec;
            if (dt <= 0.000001) return [a.lat, a.lon];

            const t = clamp01((tSec - a.tSec) / dt);

            const lat = lerp(a.lat, b.lat, t);
            const lon = lerp(a.lon, b.lon, t);

            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
            if (lat === 0 && lon === 0) return null;

            return [lat, lon];
        },
        [fixes]
    );

    // ✅ marker creation (pane + bringToFront)
    React.useEffect(() => {
        if (coreRef.current || haloRef.current) return;

        // ALWAYS on top
        ensurePane(map, "hoverMarker", 1200);

        const halo = L.circleMarker([0, 0], {
            pane: "hoverMarker",
            radius: 18,
            weight: 0,
            opacity: 0,
            fillOpacity: 0,
            fillColor: "#00ffff",
            interactive: false,
        });

        const core = L.circleMarker([0, 0], {
            pane: "hoverMarker",
            radius: 7,
            weight: 3,
            color: "#000000",
            opacity: 0,
            fillOpacity: 0,
            fillColor: "#ffffff",
            interactive: false,
        });

        halo.addTo(map);
        core.addTo(map);

        // double-safety: force draw order
        halo.bringToFront();
        core.bringToFront();

        haloRef.current = halo;
        coreRef.current = core;

        return () => {
            halo.remove();
            core.remove();
            haloRef.current = null;
            coreRef.current = null;
        };
    }, [map]);

    // ✅ smooth animation loop
    const startRafIfNeeded = React.useCallback(() => {
        if (rafRef.current != null) return;

        const step = () => {
            const halo = haloRef.current;
            const core = coreRef.current;
            const target = targetRef.current;

            if (!halo || !core) {
                rafRef.current = null;
                return;
            }

            // keep on top
            halo.bringToFront();
            core.bringToFront();

            // if no target: hide markers and stop
            if (!target) {
                halo.setStyle({ opacity: 0, fillOpacity: 0 });
                core.setStyle({ opacity: 0, fillOpacity: 0 });
                currentRef.current = null;

                // stop map follow too
                mapTargetCenterRef.current = null;
                mapCurrentCenterRef.current = null;

                rafRef.current = null;
                return;
            }

            // show markers
            halo.setStyle({ opacity: 1, fillOpacity: 0.35 });
            core.setStyle({ opacity: 1, fillOpacity: 1 });

            // current init
            let cur = currentRef.current;
            if (!cur) cur = target;

            // smooth toward target (marker)
            const next: LatLngTuple = [lerp(cur[0], target[0], MARKER_K), lerp(cur[1], target[1], MARKER_K)];

            currentRef.current = next;
            halo.setLatLng(next);
            core.setLatLng(next);

            // follow logic: decide whether we need to move/zoom the map
            if (followRef.current) {
                const now = Date.now();
                if (now - lastPanAtRef.current >= 120) {
                    lastPanAtRef.current = now;

                    const ll = L.latLng(next[0], next[1]);

                    const marginPx = 80;
                    const b = map.getBounds();
                    const nw = map.latLngToContainerPoint(b.getNorthWest());
                    const se = map.latLngToContainerPoint(b.getSouthEast());

                    const safeNW = L.point(nw.x + marginPx, nw.y + marginPx);
                    const safeSE = L.point(se.x - marginPx, se.y - marginPx);

                    if (safeSE.x > safeNW.x && safeSE.y > safeNW.y) {
                        const safeBounds = L.latLngBounds(map.containerPointToLatLng(safeNW), map.containerPointToLatLng(safeSE));

                        if (!safeBounds.contains(ll)) {
                            const viewB = map.getBounds();

                            const p = map.latLngToContainerPoint(ll);
                            const size = map.getSize();

                            const edgePad = 12;
                            const nearOrOutside = p.x < edgePad || p.y < edgePad || p.x > size.x - edgePad || p.y > size.y - edgePad;

                            if (!viewB.contains(ll) || nearOrOutside) {
                                const z = map.getZoom();
                                if (z > FOLLOW_MAX_ZOOM) {
                                    map.setZoom(FOLLOW_MAX_ZOOM, { animate: true });
                                }

                                const b2 = viewB.extend(ll);
                                const zBefore = map.getZoom();

                                map.fitBounds(b2, {
                                    padding: [FOLLOW_FIT_PADDING, FOLLOW_FIT_PADDING],
                                    maxZoom: zBefore,
                                    animate: true,
                                });

                                mapTargetCenterRef.current = null;
                                mapCurrentCenterRef.current = null;
                            } else {
                                const pt = map.latLngToContainerPoint(ll);

                                const clampedX = clamp(pt.x, safeNW.x, safeSE.x);
                                const clampedY = clamp(pt.y, safeNW.y, safeSE.y);

                                const dx = pt.x - clampedX;
                                const dy = pt.y - clampedY;

                                if (dx !== 0 || dy !== 0) {
                                    const centerPt = map.latLngToContainerPoint(map.getCenter());
                                    const targetCenterPt = L.point(centerPt.x + dx, centerPt.y + dy);
                                    const targetCenter = map.containerPointToLatLng(targetCenterPt);

                                    mapTargetCenterRef.current = targetCenter;
                                } else {
                                    mapTargetCenterRef.current = null;
                                    mapCurrentCenterRef.current = null;
                                }
                            }
                        } else {
                            mapTargetCenterRef.current = null;
                            mapCurrentCenterRef.current = null;
                        }
                    }
                }
            } else {
                mapTargetCenterRef.current = null;
                mapCurrentCenterRef.current = null;
            }

            // ✅ Smooth map center toward target (if any)
            const mapTarget = mapTargetCenterRef.current;
            if (followRef.current && mapTarget) {
                let curC = mapCurrentCenterRef.current;
                if (!curC) curC = map.getCenter();

                const nextC = L.latLng(lerp(curC.lat, mapTarget.lat, MAP_K), lerp(curC.lng, mapTarget.lng, MAP_K));

                mapCurrentCenterRef.current = nextC;
                map.setView(nextC, map.getZoom(), { animate: false });
            }

            // stop when close enough (marker), but keep running if map is still lerping
            const dLat = Math.abs(next[0] - target[0]);
            const dLon = Math.abs(next[1] - target[1]);
            const closeEnough = dLat < 1e-7 && dLon < 1e-7;

            const keepBecauseMap = !!(followRef.current && mapTargetCenterRef.current);

            if (closeEnough && !keepBecauseMap) {
                currentRef.current = target;
                halo.setLatLng(target);
                core.setLatLng(target);
                rafRef.current = null;
                return;
            }

            rafRef.current = requestAnimationFrame(step);
        };

        rafRef.current = requestAnimationFrame(step);
    }, [map]);

    // ✅ subscribe to hover store: set target only
    React.useEffect(() => {
        const unsub = useFlightHoverStore.subscribe((state) => {
            const t = state.hoverTSec;

            if (t == null) {
                targetRef.current = null;
                startRafIfNeeded();
                return;
            }

            const pos = positionAt(t);
            if (!pos) return;

            targetRef.current = pos;
            startRafIfNeeded();
        });

        return () => {
            unsub();
            if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        };
    }, [positionAt, startRafIfNeeded]);

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


function buildChunkRangesFromSegColors(segColors: string[], startIdx: number, endIdx: number): ChunkRange[] {
    // segments are [0..n-2], points are [0..n-1]
    // window points: startIdx..endIdx (inclusive)
    // segments in window: startIdx..endIdx-1
    if (!segColors.length) return [];
    if (endIdx <= startIdx) return [];

    const s = Math.max(0, Math.min(startIdx, segColors.length));       // segment start
    const e = Math.max(0, Math.min(endIdx - 1, segColors.length - 1)); // segment end

    if (e < s) return [];

    const out: ChunkRange[] = [];
    let runColor = segColors[s];
    let runStartSeg = s;

    for (let i = s + 1; i <= e; i++) {
        const c = segColors[i];
        if (c !== runColor) {
            // segments runStartSeg..(i-1) => points runStartSeg..i
            out.push({ color: runColor, fromIdx: runStartSeg, toIdx: i });
            runColor = c;
            runStartSeg = i;
        }
    }

    // tail: runStartSeg..e => points runStartSeg..(e+1)
    out.push({ color: runColor, fromIdx: runStartSeg, toIdx: e + 1 });

    return out;
}


type FlightMapProps = {
    watchKey?: unknown;
    fixesFull: FixPoint[];
    fixesLite: FixPoint[];
    thermals: ThermalCircle[];
};

export const FlightMap = React.memo(
    function FlightMap({
        watchKey,
        fixesFull,
        fixesLite,
        thermals,
    }: FlightMapProps) {

        const baseMap = useFlightDetailsUiStore((s) => s.baseMap);
        const followEnabled = useFlightDetailsUiStore((s) => s.followEnabled);
        const showThermalsOnMap = useFlightDetailsUiStore((s) => s.showThermalsOnMap);


        const hasTrack = fixesFull.length >= 2;
        const initialZoom = hasTrack ? 13 : 11;

        const win = useTimeWindowStore((s) => s.window);
        const setWindowThrottled = useTimeWindowStore((s) => s.setWindowThrottled);
        const setWindow = useTimeWindowStore((s) => s.setWindow);
        const isDragging = useTimeWindowStore((s) => s.isDragging);
        const setDragging = useTimeWindowStore((s) => s.setDragging);

        const windConfig = useWindConfigStore((s) => s.config);

        // Adapter: FixPoint -> WindFix (avoid type coupling)
        const windFixes = React.useMemo(() => fixesFull.map(({ tSec, lat, lon }) => ({ tSec, lat, lon })), [fixesFull]);


        const pre = React.useMemo(() => {
            const n = fixesFull.length;
            if (n < 2) return { latlngs: [] as LatLngTuple[], segColors: [] as string[] };

            const latlngs = new Array<LatLngTuple>(n);
            for (let i = 0; i < n; i++) latlngs[i] = [fixesFull[i].lat, fixesFull[i].lon];

            // color per segment i -> i+1
            const segColors = new Array<string>(n - 1);
            let lastV = 0;

            for (let i = 0; i < n - 1; i++) {
                const a = fixesFull[i];
                const b = fixesFull[i + 1];

                const dt = b.tSec - a.tSec;
                if (dt > 0) lastV = (b.altitudeM - a.altitudeM) / dt;

                segColors[i] = colorForVario(lastV);
            }

            return { latlngs, segColors };
        }, [fixesFull]);

        // Adapter: TimeWindow -> WindRange (avoid type coupling)
        const windRange = React.useMemo(() => {
            if (!win) return null;
            return { startSec: win.startSec, endSec: win.endSec };
        }, [win]);



        const windowBounds = React.useMemo(() => {
            if (!win) return null;
            const src = fixesLite && fixesLite.length >= 2 ? fixesLite : fixesFull;
            const pts = sliceFixesByWindow(src, win.startSec, win.endSec);
            return pts.length >= 2 ? computeBounds(pts) : null;
        }, [win, fixesLite, fixesFull]);

        const [zoom, setZoom] = React.useState<number>(initialZoom);
        React.useEffect(() => setZoom(initialZoom), [initialZoom]);

        const fullPoints = React.useMemo(() => {
            const out = new Array<LatLngTuple>(fixesFull.length);
            for (let i = 0; i < fixesFull.length; i++) out[i] = [fixesFull[i].lat, fixesFull[i].lon];
            return out;
        }, [fixesFull]);

        const baseFullPoints = fullPoints;

        const totalSeconds = fixesFull.length ? fixesFull[fixesFull.length - 1].tSec : 0;
        const wind = useWindEstimate(windFixes, windRange ?? { startSec: 0, endSec: totalSeconds }, windConfig);

        // window is Source-of-Truth (from store), fallback to full range
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

        const chunkRanges = React.useMemo(() => {
            if (!hasTrack) return [];
            if (isDragging) return [];
            return buildChunkRangesFromSegColors(pre.segColors, startIdx, endIdx);
        }, [hasTrack, isDragging, pre.segColors, startIdx, endIdx]);

        const center: LatLngTuple = fullPoints.length ? fullPoints[0] : [48.1372, 11.5756];
        const bounds = React.useMemo(() => computeBounds(fullPoints), [fullPoints]);

        const { line, outlineExtra, outlineOpacity } = React.useMemo(() => weightsForZoom(zoom), [zoom]);
        const dragStyle = React.useMemo(() => dragStyleForZoomTopoGlow(zoom), [zoom]);

        const outlineWeight = line + outlineExtra;
        const OUTLINE = "rgba(0, 0, 0, 0.51)";

        const tile = TILE[baseMap];

        const startPct = pct(startSec, totalSeconds);
        const endPct = pct(endSec, totalSeconds);

        return (
            <Box style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                <Group justify="space-between" mb="xs">
                    <Text fw={600}>Flight window</Text>
                    <Text c="dimmed">
                        {startPct}% ({formatTime(startSec)}) → {endPct}% ({formatTime(endSec)}) / {formatTime(totalSeconds)}
                    </Text>
                </Group>

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

                        {/* Base track */}
                        <ActiveTrackLayer
                            paneName="trackBase"
                            points={baseFullPoints}
                            weight={Math.max(2.2, line * 0.9)}
                            watchKey={watchKey}
                            color="rgba(120,120,130,0.55)"
                            opacity={1}
                        />

                        {/* ✅ Thermal circles: allow low quality + few points so single turns render */}
                        {showThermalsOnMap && (
                            <>
                                <ThermalCirclesLayer
                                    fixesFull={fixesFull}
                                    thermals={thermals}
                                    minQuality={0.05} // was 0.20
                                    minPts={6} // was 25
                                    simplifyEveryN={1} // was 2 (don’t kill small circles)
                                />
                            </>
                        )}


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

                        {/* ✅ Hover marker ALWAYS top */}
                        <HoverMarker fixes={fixesFull} followEnabled={followEnabled} />

                        <WindLayer
                            fixes={windFixes}
                            range={windRange}
                            windowEstimate={wind.window}
                            opposite180Estimate={wind.opposite180}
                            arrowScaleSec={500}
                            minQuality={0.15}
                        />
                        {!isDragging && chunkRanges.length > 0 && (
                            <ColorChunkRangesLayer
                                latlngs={pre.latlngs}
                                ranges={chunkRanges}
                                outlineWeight={outlineWeight}
                                outlineOpacity={outlineOpacity}
                                line={line}
                                paneName="trackColor"
                            />
                        )}

                        <ZoomWatcher onZoom={setZoom} />
                        <MapAutoResize watchKey={watchKey} />

                        <FitBoundsController
                            fullBounds={bounds}
                            windowBounds={windowBounds}
                            win={win}
                            isDragging={isDragging}
                            watchKey={watchKey}
                        />

                    </MapContainer>
                </Box>
            </Box>
        );
    },
    (prev, next) => {
        return (
            prev.watchKey === next.watchKey &&
            prev.fixesFull === next.fixesFull &&
            prev.fixesLite === next.fixesLite &&
            prev.thermals === next.thermals
        );
    }
);
