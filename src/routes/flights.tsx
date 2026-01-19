import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/flights")({
    component: FlightsLayout,
});

function FlightsLayout() {
    return <Outlet />; // <-- DAS ist die entscheidende Zeile
}