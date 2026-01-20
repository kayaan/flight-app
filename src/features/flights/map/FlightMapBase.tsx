import * as React from "react";
import { MapContainer, TileLayer, Polyline, useMap } from "react-leaflet";
import type { LatLngTuple } from "leaflet";

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
export function FlightMap({
    points,
    watchKey,
}: {
    points: LatLngTuple[];
    watchKey?: unknown;
}) {
    const hasTrack = points.length >= 2;

    return (
        <MapContainer
            center={hasTrack ? points[0] : [48.1372, 11.5756]}
            zoom={hasTrack ? 13 : 11}
            style={{ height: "100%", width: "100%" }}
        >
            <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="&copy; OpenStreetMap contributors"
            />

            {hasTrack && <Polyline positions={points} />}

            {/* DAS ist der wichtige Teil */}
            <MapAutoResize watchKey={watchKey} />
        </MapContainer>
    );
}