import { create } from "zustand";
import type { FlightRecordDetails } from "../flights.types";
import { flightApi } from "../flights.api";

type LoadOptions = {
    force?: boolean;
}

type FlightsStatus = "idle" | "loading" | "ready" | "error";
type SortDir = "asc" | "desc";


type FlightState = {
    flights: FlightRecordDetails[];
    status: FlightsStatus;
    error: string | null;

    loadedOnce: boolean;
    stale: boolean;

    load: (token: string, opt?: LoadOptions) => Promise<void>;
    setFlights: (flights: FlightRecordDetails[]) => void;
    invalidate: () => void;
    reset: () => void;

    sortKey: string;
    sortDir: SortDir;

    setSortKey: (k: string) => void;
    setSortDir: (d: SortDir) => void;
}

export const useFlightsStore = create<FlightState>((set, get) => ({
    flights: [],
    status: "idle",
    error: null,

    loadedOnce: false,
    stale: false,

    setFlights: (flights => {
        set({
            flights,
            status: "ready",
            error: null,
            loadedOnce: true,
            stale: false,
        })
    }),
    invalidate: () => {
        set({ stale: true })
    },
    reset: () => {
        set({
            flights: [],
            status: "idle",
            error: null,
            loadedOnce: false,
            stale: false,

            sortKey: "flightDate",
            sortDir: "desc"
        })
    },

    load: async (token, opts) => {
        const { force = false } = opts ?? {};
        const state = get();

        if (!force && state.loadedOnce && !state.stale) return;

        if (state.status === "loading") return;

        set({ status: "loading", error: null });

        try {
            const data = await flightApi.list(token);

            set({
                flights: data,
                status: "ready",
                error: null,
                loadedOnce: true,
                stale: false,
            })
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed to load flights";

            set({ status: "error", error: msg })
        }
    },

    sortKey: "flightDate",
    sortDir: "desc",

    setSortKey: (k => {
        set({ sortKey: k })
    }),

    setSortDir: (d => {
        set({ sortDir: d })
    })
}))

export const useFlights = () => useFlightsStore(s => s.flights);
export const useFlightsStatus = () => useFlightsStore(s => s.status);
export const useFlightsError = () => useFlightsStore(s => s.error);
