import { create } from "zustand";
import type { FlightRecordDetails } from "../flights.types";
import { flightApiLocal } from "../flights.api.local";
import { createJSONStorage, persist } from "zustand/middleware";


type LoadOptions = {
    force?: boolean;
};

type FlightsStatus = "idle" | "loading" | "ready" | "error";
type SortDir = "asc" | "desc";

type FlightState = {
    flights: FlightRecordDetails[];
    status: FlightsStatus;
    error: string | null;

    loadedOnce: boolean;
    stale: boolean;

    // internal: if a load request comes in while loading, do a trailing reload afterwards
    _loadPending: boolean;

    load: (token: string, opt?: LoadOptions) => Promise<void>;
    setFlights: (flights: FlightRecordDetails[]) => void;
    invalidate: () => void;
    reset: () => void;

    sortKey: string;
    sortDir: SortDir;

    setSortKey: (k: string) => void;
    setSortDir: (d: SortDir) => void;
};



export const useFlightsStore = create<FlightState>()(
    persist(
        (set, get) => ({
            flights: [],
            status: "idle",
            error: null,

            loadedOnce: false,
            stale: false,

            _loadPending: false,

            setFlights: (flights) => {
                set({
                    flights,
                    status: "ready",
                    error: null,
                    loadedOnce: true,
                    stale: false,
                });
            },

            invalidate: () => {
                set({ stale: true });
            },

            reset: () => {
                set({
                    flights: [],
                    status: "idle",
                    error: null,
                    loadedOnce: false,
                    stale: false,
                    _loadPending: false,

                    // ⚠️ Sortierung NICHT anfassen, damit Preference erhalten bleibt
                    // sortKey: "flightDate",
                    // sortDir: "desc",
                });
            },

            load: async (token, opts) => {
                const { force = false } = opts ?? {};
                const state = get();

                const shouldLoad = force || !state.loadedOnce || state.stale;

                if (state.status === "loading") {
                    if (shouldLoad) set({ _loadPending: true });
                    return;
                }

                if (!shouldLoad) return;

                set({ status: "loading", error: null });

                try {
                    const data = await flightApiLocal.list(token);

                    set({
                        flights: data,
                        status: "ready",
                        error: null,
                        loadedOnce: true,
                        stale: false,
                    });

                    const after = get();
                    if (after._loadPending) {
                        set({ _loadPending: false, stale: true });
                        await get().load(token, { force: false });
                    }
                } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : "Failed to load flights";
                    set({ status: "error", error: msg });
                }
            },

            sortKey: "flightDate",
            sortDir: "desc",

            setSortKey: (k) => {
                set({ sortKey: k });
            },

            setSortDir: (d) => {
                set({ sortDir: d });
            },
        }),
        {
            name: "flyapp:flights:sort",
            storage: createJSONStorage(() => localStorage),
            partialize: (s) => ({ sortKey: s.sortKey, sortDir: s.sortDir }),
        }
    )
);


export const useFlights = () => useFlightsStore((s) => s.flights);
export const useFlightsStatus = () => useFlightsStore((s) => s.status);
export const useFlightsError = () => useFlightsStore((s) => s.error);
