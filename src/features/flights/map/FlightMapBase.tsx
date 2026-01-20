import * as React from "react";
import { MapContainer, TileLayer, Polyline, useMap } from "react-leaflet";
import type { LatLngTuple } from "leaflet";

type BaseMap = "osm" | "topo";

function MapAutoResize({ watchKey }: { watchKey?: unknown }) {
    const map = useMap();

    React.useEffect(() => {
        // direkt + nochmal kurz später (CSS/layout settle)
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
    watchKey,
    baseMap = "osm"
}: {
    points: LatLngTuple[];
    watchKey?: unknown;
    baseMap?: BaseMap
}) {
    const hasTrack = points.length >= 2;

    const tile = TILE[baseMap];

    return (
        <MapContainer /* ... */ style={{ height: "100%", width: "100%" }}>
            <TileLayer
                key={tile.key}          // <- wichtig: remount beim Wechsel
                url={tile.url}
                attribution={tile.attribution}
            />
            {hasTrack && <Polyline positions={points} />}

            {/* DAS ist der wichtige Teil */}
            <MapAutoResize watchKey={watchKey} />
        </MapContainer>
    );
}