import { createFileRoute } from "@tanstack/react-router";
import { FlightsPage } from "../features/flights/FlightsPage";

export const Route = createFileRoute('/flights')({
    component: FlightsPage
})