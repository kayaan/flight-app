import * as React from "react";
import { MapContainer, TileLayer, Polyline, useMap } from "react-leaflet";
import type { LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";

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
    baseMap = "osm",
}: {
    points: LatLngTuple[];
    watchKey?: unknown;
    baseMap?: BaseMap;
}) {
    const hasTrack = points.length >= 2;

    // fallback center (München)
    const fallbackCenter: LatLngTuple = [48.1372, 11.5756];

    // wenn Track da: nimm ersten Punkt als initial center
    const center = hasTrack ? points[0] : fallbackCenter;
    const zoom = hasTrack ? 13 : 11;

    const tile = TILE[baseMap];

    return (
        <MapContainer
            center={center}
            zoom={zoom}
            style={{ height: "100%", width: "100%" }}
            preferCanvas
        >
            <TileLayer
                key={tile.key} // remount beim Wechsel
                url={tile.url}
                attribution={tile.attribution}
            />

            {hasTrack && <Polyline positions={points} />}

            <MapAutoResize watchKey={watchKey} />
        </MapContainer>
    );
}
