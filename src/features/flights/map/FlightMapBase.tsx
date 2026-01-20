import React from "react";
import { MapContainer, TileLayer, Polyline, useMap } from "react-leaflet";
import { type LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Marker, Popup } from "react-leaflet";

type Props = {
    points: LatLngTuple[];
    fallbackCenter?: LatLngTuple;
    fallbackZoom?: number;
};

function FitToTrack({ points }: { points: LatLngTuple[] }) {
    const map = useMap();

    React.useEffect(() => {
        if (points.length < 2) return;
        map.fitBounds(points, { padding: [20, 20] });
    }, [map, points]);

    return null;
}

export function FlightMap({
    points,
    fallbackCenter = [48.1372, 11.5756],
    fallbackZoom = 11,
}: Props) {
    const hasTrack = points.length >= 2;

    return (
        <MapContainer
            center={hasTrack ? points[0] : fallbackCenter}
            zoom={hasTrack ? 13 : fallbackZoom}
            style={{ height: "100%", width: "100%" }}
        >
            <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="&copy; OpenStreetMap contributors"
            />

            {hasTrack && (
                <>
                    <Polyline positions={points} />
                    <FitToTrack points={points} />
                    <Marker position={points[0]}>
                        <Popup>Takeoff</Popup>
                    </Marker>

                    <Marker position={points[points.length - 1]}>
                        <Popup>Landing</Popup>
                    </Marker>
                </>
            )}
        </MapContainer>
    );
}
