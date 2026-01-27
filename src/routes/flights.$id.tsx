import { createFileRoute } from "@tanstack/react-router";
import { FlightDetailsRoute } from "../features/flights/FlightDetailsRoute";

export const Route = createFileRoute("/flights/$id")({
  component: FlightDetailsRoute,
});