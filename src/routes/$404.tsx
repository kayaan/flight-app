import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/$404")({
    component: () => <Navigate to="/flights" replace />,
});