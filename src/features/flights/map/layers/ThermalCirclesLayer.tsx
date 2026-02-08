import * as React from "react";
import L, { type LatLngTuple } from "leaflet";
import { useMap } from "react-leaflet";

import type { FixPoint } from "../../igc";
import type { ThermalCircle } from "../../analysis/turns/detectThermalCircles";

export type ThermalCirclesLayerProps = {
    fixesFull: FixPoint[];
    thermals: ThermalCircle[];

    // Debug knobs
    minQuality?: number;     // e.g. 0.25
    minPts?: number;         // e.g. 25
    simplifyEveryN?: number; // e.g. 1..5 (performance)
};

function clamp(n: number, a: number, b: number) {
    return Math.min(b, Math.max(a, n));
}

function sliceLatLng(
    fixes: FixPoint[],
    startIdx: number,
    endIdx: number,
    simplifyEveryN: number
): LatLngTuple[] {
    const n = fixes.length;
    const s = clamp(startIdx, 0, n - 2);
    const e = clamp(endIdx, s + 1, n - 1);
    const step = Math.max(1, Math.floor(simplifyEveryN));

    const out: LatLngTuple[] = [];
    for (let i = s; i <= e; i += step) {
        const f = fixes[i];
        const lat = f.lat;
        const lon = f.lon;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (lat === 0 && lon === 0) continue;
        out.push([lat, lon]);
    }

    // ensure last point included
    const last = fixes[e];
    if (last && out.length) {
        const p: LatLngTuple = [last.lat, last.lon];
        const prev = out[out.length - 1];
        if (prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
    }

    return out;
}

// simple palette, repeats
const PALETTE = [
    "#ff6b6b",
    "#ffd43b",
    "#69db7c",
    "#4dabf7",
    "#da77f2",
    "#ffa94d",
    "#40c057",
    "#748ffc",
];

export function ThermalCirclesLayer(props: ThermalCirclesLayerProps) {
    const map = useMap();

    const { fixesFull, thermals, minQuality = 0.25, minPts = 25, simplifyEveryN = 2 } = props;

    const layerRef = React.useRef<L.LayerGroup | null>(null);

    React.useEffect(() => {
        if (layerRef.current) return;

        const paneName = "thermalsPane";
        if (!map.getPane(paneName)) {
            const pane = map.createPane(paneName);
            pane.style.zIndex = "1001"; // above track
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

        const paneName = "thermalsPane";

        let idxColor = 0;

        for (const th of thermals) {
            if (!th) continue;
            if (!Number.isFinite(th.quality) || th.quality < minQuality) continue;

            const s = th.startIdx;
            const e = th.endIdx;
            const lenPts = e - s + 1;
            if (lenPts < minPts) continue;

            const color = PALETTE[idxColor % PALETTE.length];
            idxColor++;

            const pts = sliceLatLng(fixesFull, s, e, simplifyEveryN);
            if (pts.length < 2) continue;

            // Main thermal segment polyline (thick + vivid)
            const line = L.polyline(pts, {
                pane: paneName,
                color,
                weight: 6,
                opacity: 0.95,
                lineCap: "round",
                lineJoin: "round",
                interactive: false,
            });

            // Optional: black outline for contrast (still no "grey frame UI", just a stroke)
            const outline = L.polyline(pts, {
                pane: paneName,
                color: "rgba(0,0,0,0.65)",
                weight: 9,
                opacity: 0.55,
                lineCap: "round",
                lineJoin: "round",
                interactive: false,
            });

            // Anchor dot at midpoint (helps visually)
            const midIdx = clamp(((s + e) / 2) | 0, 0, fixesFull.length - 1);
            const mid = fixesFull[midIdx];
            const dot = L.circleMarker([mid.lat, mid.lon], {
                pane: paneName,
                radius: 5,
                weight: 2,
                color: "rgba(0,0,0,0.8)",
                fillColor: color,
                fillOpacity: 1,
                interactive: false,
            });

            g.addLayer(outline);
            g.addLayer(line);
            g.addLayer(dot);
        }
    }, [map, fixesFull, thermals, minQuality, minPts, simplifyEveryN]);

    return null;
}
