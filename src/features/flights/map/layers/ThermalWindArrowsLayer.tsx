// src/features/flights/map/layers/ThermalWindArrowsLayer.tsx
import * as React from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";

import type { FixPoint } from "../../igc";
import type { ThermalCircle } from "../../analysis/turns/detectThermalCircles";

export type ThermalWindArrowsLayerProps = {
    fixesFull: FixPoint[];
    thermals: ThermalCircle[];

    // arrow length in meters = windSpeedMs * arrowScaleSec
    arrowScaleSec?: number;

    // show only good ones
    minQuality?: number;

    // visual
    color?: string;
};

function clamp(n: number, a: number, b: number) {
    return Math.min(b, Math.max(a, n));
}

function toRad(d: number) {
    return (d * Math.PI) / 180;
}

// local meters around ref
function projectLocalMeters(lat: number, lon: number, refLat: number, refLon: number) {
    const R = 6371000;
    const φ = toRad(lat);
    const φ0 = toRad(refLat);
    const dφ = φ - φ0;
    const dλ = toRad(lon - refLon);
    const x = dλ * Math.cos(φ0) * R; // east
    const y = dφ * R;               // north
    return { x, y };
}
function unprojectLocalMeters(x: number, y: number, refLat: number, refLon: number) {
    const R = 6371000;
    const φ0 = toRad(refLat);
    const dφ = y / R;
    const dλ = x / (R * Math.cos(φ0));
    const lat = refLat + (dφ * 180) / Math.PI;
    const lon = refLon + (dλ * 180) / Math.PI;
    return { lat, lon };
}

export function ThermalWindArrowsLayer(props: ThermalWindArrowsLayerProps) {
    const map = useMap();

    const {
        fixesFull,
        thermals,
        arrowScaleSec = 120,
        minQuality = 0.25,
        color = "#ff8c00",
    } = props;

    const layerRef = React.useRef<L.LayerGroup | null>(null);

    React.useEffect(() => {
        if (layerRef.current) return;

        const paneName = "thermalWindPane";
        if (!map.getPane(paneName)) {
            const pane = map.createPane(paneName);
            pane.style.zIndex = "1002";
            pane.style.pointerEvents = "none";
        }

        const g = L.layerGroup({ pane: paneName } as any);
        g.addTo(map);
        layerRef.current = g;

        return () => {
            g.remove();
            layerRef.current = null;
        };
    }, [map]);

    React.useEffect(() => {
        const g = layerRef.current;
        if (!g) return;

        g.clearLayers();

        if (!fixesFull || fixesFull.length < 2) return;
        if (!thermals || thermals.length === 0) return;

        const paneName = "thermalWindPane";

        for (const t of thermals) {
            if (!t) continue;
            if (!Number.isFinite(t.windSpeedMs) || t.windSpeedMs <= 0.2) continue;
            if (!Number.isFinite(t.quality) || t.quality < minQuality) continue;

            // anchor = mid index
            const midIdx = clamp(((t.startIdx + t.endIdx) / 2) | 0, 0, fixesFull.length - 1);
            const a = fixesFull[midIdx];
            if (!a) continue;

            const refLat = a.lat;
            const refLon = a.lon;

            // wind drift vector (east/north) in m/s
            const vx = t.driftVxMs;
            const vy = t.driftVyMs;

            const vLen = Math.hypot(vx, vy);
            if (vLen <= 1e-6) continue;

            const ux = vx / vLen;
            const uy = vy / vLen;

            const lenM = t.windSpeedMs * arrowScaleSec;

            // start is anchor, tip is moved by local meters
            const tip = unprojectLocalMeters(ux * lenM, uy * lenM, refLat, refLon);

            const startLL = L.latLng(refLat, refLon);
            const tipLL = L.latLng(tip.lat, tip.lon);

            const w = clamp(3 + t.windSpeedMs * 0.9, 4, 9);

            const line = L.polyline([startLL, tipLL], {
                pane: paneName,
                color,
                weight: w,
                opacity: 0.95,
                lineCap: "round",
                lineJoin: "round",
                interactive: false,
            });

            // arrow head
            const headLen = Math.min(26, Math.max(10, lenM * 0.20));
            const headAngle = 28;

            const rot = (x: number, y: number, deg: number) => {
                const r = (deg * Math.PI) / 180;
                const c = Math.cos(r);
                const s = Math.sin(r);
                return { x: x * c - y * s, y: x * s + y * c };
            };

            const left = rot(-ux, -uy, +headAngle);
            const right = rot(-ux, -uy, -headAngle);

            const leftLL = unprojectLocalMeters(ux * lenM + left.x * headLen, uy * lenM + left.y * headLen, refLat, refLon);
            const rightLL = unprojectLocalMeters(ux * lenM + right.x * headLen, uy * lenM + right.y * headLen, refLat, refLon);

            const head = L.polyline(
                [L.latLng(leftLL.lat, leftLL.lon), tipLL, L.latLng(rightLL.lat, rightLL.lon)],
                { pane: paneName, color, weight: w, opacity: 0.95, interactive: false, lineCap: "round", lineJoin: "round" }
            );

            g.addLayer(line);
            g.addLayer(head);
        }
    }, [map, fixesFull, thermals, arrowScaleSec, minQuality, color]);

    return null;
}
