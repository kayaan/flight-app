import * as React from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";

import type { WindEstimate } from "../../analysis/wind/wind.types";
import { deg2rad, projectMeters, unprojectMeters, vecLen } from "../../analysis/wind/wind.math";




type WindFix = { tSec: number; lat: number; lon: number };
type WindRange = { startSec: number; endSec: number } | null;

export type WindLayerProps = {
    fixes: WindFix[];
    range: WindRange;

    // provide both, we pick the better one
    windowEstimate: WindEstimate | null;
    opposite180Estimate: WindEstimate | null;

    // meters = speedMs * arrowScaleSec (so arrow length is zoom-independent)
    arrowScaleSec?: number;

    // hide if estimate is too weak
    minQuality?: number;
};

function pickBestEstimate(a: WindEstimate | null, b: WindEstimate | null) {
    if (a && b) return b.quality >= a.quality ? b : a;
    return b ?? a;
}

function findAnchorFix(fixes: WindFix[], range: WindRange): WindFix | null {
    if (fixes.length === 0) return null;

    // If no range: anchor at middle of the whole flight
    if (!range) return fixes[(fixes.length / 2) | 0] ?? null;

    const start = Math.min(range.startSec, range.endSec);
    const end = Math.max(range.startSec, range.endSec);
    const midT = (start + end) / 2;

    // Simple scan (OK for now). Can be optimized to binary search later.
    let best: WindFix | null = null;
    let bestDist = Infinity;

    for (let i = 0; i < fixes.length; i++) {
        const d = Math.abs(fixes[i].tSec - midT);
        if (d < bestDist) {
            bestDist = d;
            best = fixes[i];
        }
    }
    return best;
}

/**
 * Draw a wind arrow + label at an anchor position.
 * "dirDeg" is the direction the wind is blowing TO (0=N, 90=E).
 */
export function WindLayer(props: WindLayerProps) {
    const map = useMap();

    const {
        fixes,
        range,
        windowEstimate,
        opposite180Estimate,
        arrowScaleSec = 12,
        minQuality = 0.15,
    } = props;

    const layerRef = React.useRef<L.LayerGroup | null>(null);

    // Create layer group once
    React.useEffect(() => {
        if (layerRef.current) return;

        // Create custom pane above everything
        const paneName = "windPane";
        if (!map.getPane(paneName)) {
            const pane = map.createPane(paneName);
            pane.style.zIndex = "1000";      // higher than overlays (default ~400–650)
            pane.style.pointerEvents = "auto";
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

        const est = pickBestEstimate(windowEstimate, opposite180Estimate);
        if (!est) return;
        if (!Number.isFinite(est.speedMs) || est.speedMs <= 0) return;
        if (est.quality < minQuality) return;

        const anchor = findAnchorFix(fixes, range);
        if (!anchor) return;

        const { lat: refLat, lon: refLon } = anchor;

        // Convert (dirDeg, speedMs) -> local (xEast, yNorth) vector
        const θ = deg2rad(est.dirDeg);
        const vx = Math.sin(θ) * est.speedMs; // east
        const vy = Math.cos(θ) * est.speedMs; // north

        // Arrow length in meters (zoom-independent)
        const lenM = est.speedMs * arrowScaleSec;
        if (!Number.isFinite(lenM) || lenM <= 0) return;

        // Build arrow endpoint in lat/lon by moving from anchor in local meters
        const a0 = projectMeters(refLat, refLon, refLat, refLon); // (0,0)
        const vLen = vecLen(vx, vy);
        if (vLen <= 1e-9) return;

        const ux = vx / vLen;
        const uy = vy / vLen;

        const tip = unprojectMeters(a0.x + ux * lenM, a0.y + uy * lenM, refLat, refLon);

        const startLL = L.latLng(refLat, refLon);
        const tipLL = L.latLng(tip.lat, tip.lon);

        // Main arrow line
        const line = L.polyline([startLL, tipLL], {
            color: "#ff0000",
            weight: 4,
            opacity: 0.95,
            interactive: true,
            bubblingMouseEvents: false,
        });

        // Simple arrow head (small V)
        const headLen = Math.min(18, Math.max(8, lenM * 0.2)); // meters
        const headAngle = 28; // degrees

        // Build two head points by rotating the direction vector
        const base = projectMeters(tip.lat, tip.lon, refLat, refLon);
        const dirX = ux;
        const dirY = uy;

        const rot = (x: number, y: number, deg: number) => {
            const r = deg2rad(deg);
            const c = Math.cos(r);
            const s = Math.sin(r);
            return { x: x * c - y * s, y: x * s + y * c };
        };

        const left = rot(-dirX, -dirY, +headAngle);
        const right = rot(-dirX, -dirY, -headAngle);

        const leftLL = unprojectMeters(base.x + left.x * headLen, base.y + left.y * headLen, refLat, refLon);
        const rightLL = unprojectMeters(base.x + right.x * headLen, base.y + right.y * headLen, refLat, refLon);

        const head = L.polyline(
            [L.latLng(leftLL.lat, leftLL.lon), tipLL, L.latLng(rightLL.lat, rightLL.lon)],
            {
                color: "#ff0000",
                weight: 4,
                opacity: 0.95,
                interactive: true,
                bubblingMouseEvents: false,
            }
        );

        const kmh = est.speedMs * 3.6;
        const label = `${Math.round(est.dirDeg)}°  ${est.speedMs.toFixed(1)} m/s (${kmh.toFixed(0)} km/h)`;

        const labelIcon = L.divIcon({
            className: "wind-label",
            html: `<div>${label}</div>`,
        });
        const labelMarker = L.marker(startLL, {
            icon: labelIcon,
            interactive: false,
        });

        g.addLayer(labelMarker);

        line.on("mouseover", () => line.openTooltip());
        line.on("mouseout", () => line.closeTooltip());

        g.addLayer(line);
        g.addLayer(head);
    }, [map, fixes, range, windowEstimate, opposite180Estimate, arrowScaleSec, minQuality]);

    return null;
}
