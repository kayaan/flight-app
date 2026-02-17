// src/features/flights/store/flightDetailsUi.store.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type BaseMap = "osm" | "topo" | "esriBalanced";

function clamp(n: number, min: number, max: number) {
    return Math.min(max, Math.max(min, n));
}

export type FlightDetailsUiState = {
    // UI prefs
    autoFitSelection: boolean;
    zoomSyncEnabled: boolean; // "Sync chart zoom"
    syncEnabled: boolean; // "Charts sync"
    followEnabled: boolean;
    showStats: boolean;

    showAlt: boolean;
    showVario: boolean;
    showSpeed: boolean;

    varioWindowSec: number;

    baseMap: BaseMap;

    // toggles
    showClimbPhases: boolean;

    // ✅ NEW: chart/map overlays
    showClimbLinesOnChart: boolean;
    showThermalsOnMap: boolean;

    // setters
    setAutoFitSelection: (v: boolean) => void;
    setZoomSyncEnabled: (v: boolean) => void;
    setSyncEnabled: (v: boolean) => void;
    setFollowEnabled: (v: boolean) => void;
    setShowStats: (v: boolean) => void;

    setShowAlt: (v: boolean) => void;
    setShowVario: (v: boolean) => void;
    setShowSpeed: (v: boolean) => void;

    setVarioWindowSec: (v: number) => void;

    setBaseMap: (v: BaseMap) => void;

    setShowClimbPhases: (v: boolean) => void;

    // ✅ NEW
    setShowClimbLinesOnChart: (v: boolean) => void;
    setShowThermalsOnMap: (v: boolean) => void;

    // convenience
    resetUiPrefs: () => void;
};

const DEFAULTS = {
    autoFitSelection: true,
    zoomSyncEnabled: true,
    syncEnabled: true,
    followEnabled: true,
    showStats: true,

    showAlt: true,
    showVario: true,
    showSpeed: true,

    varioWindowSec: 4,

    baseMap: "esriBalanced" as BaseMap,

    showClimbPhases: true,

    // ✅ NEW
    showClimbLinesOnChart: true,
    showThermalsOnMap: true,
};

export const useFlightDetailsUiStore = create<FlightDetailsUiState>()(
    persist(
        (set, get) => ({
            ...DEFAULTS,

            setAutoFitSelection: (v) => set({ autoFitSelection: !!v }),
            setZoomSyncEnabled: (v) => set({ zoomSyncEnabled: !!v }),
            setSyncEnabled: (v) => set({ syncEnabled: !!v }),
            setFollowEnabled: (v) => set({ followEnabled: !!v }),
            setShowStats: (v) => set({ showStats: !!v }),

            setShowAlt: (v) => set({ showAlt: !!v }),
            setShowVario: (v) => set({ showVario: !!v }),
            setShowSpeed: (v) => set({ showSpeed: !!v }),

            setVarioWindowSec: (v) => {
                const n = typeof v === "number" ? v : Number(v);
                if (!Number.isFinite(n)) return;
                set({ varioWindowSec: clamp(Math.round(n), 1, 30) });
            },

            setBaseMap: (v) => set({ baseMap: v }),

            setShowClimbPhases: (v) => set({ showClimbPhases: !!v }),

            // ✅ NEW
            setShowClimbLinesOnChart: (v) => set({ showClimbLinesOnChart: !!v }),
            setShowThermalsOnMap: (v) => set({ showThermalsOnMap: !!v }),

            resetUiPrefs: () => {
                // keep persisted shape stable; hard reset to defaults
                set({ ...DEFAULTS });
            },
        }),
        {
            name: "flyapp.flightDetails.uiPrefs",
            version: 3, // ✅ bumped because we added fields
            storage: createJSONStorage(() => localStorage),
            partialize: (s) => ({
                autoFitSelection: s.autoFitSelection,
                zoomSyncEnabled: s.zoomSyncEnabled,
                syncEnabled: s.syncEnabled,
                followEnabled: s.followEnabled,
                showStats: s.showStats,

                showAlt: s.showAlt,
                showVario: s.showVario,
                showSpeed: s.showSpeed,

                varioWindowSec: s.varioWindowSec,

                baseMap: s.baseMap,

                showClimbPhases: s.showClimbPhases,

                // ✅ NEW
                showClimbLinesOnChart: s.showClimbLinesOnChart,
                showThermalsOnMap: s.showThermalsOnMap,
            }),
            migrate: (persisted: any, version) => {
                // future-proof: if you bump version, normalize missing fields
                if (!persisted || typeof persisted !== "object") return { ...DEFAULTS };

                // normalize baseMap
                const baseMap: BaseMap =
                    persisted.baseMap === "osm" || persisted.baseMap === "topo" || persisted.baseMap === "esriBalanced"
                        ? persisted.baseMap
                        : DEFAULTS.baseMap;

                // normalize varioWindowSec
                const varioWindowSec =
                    typeof persisted.varioWindowSec === "number" && Number.isFinite(persisted.varioWindowSec)
                        ? clamp(Math.round(persisted.varioWindowSec), 1, 30)
                        : DEFAULTS.varioWindowSec;

                // normalize booleans (also handles older ad-hoc shapes)
                const showClimbPhases =
                    typeof persisted.showClimbPhases === "boolean" ? persisted.showClimbPhases : DEFAULTS.showClimbPhases;

                const showClimbLinesOnChart =
                    typeof persisted.showClimbLinesOnChart === "boolean"
                        ? persisted.showClimbLinesOnChart
                        : DEFAULTS.showClimbLinesOnChart;

                const showThermalsOnMap =
                    typeof persisted.showThermalsOnMap === "boolean" ? persisted.showThermalsOnMap : DEFAULTS.showThermalsOnMap;

                return {
                    ...DEFAULTS,
                    ...persisted,
                    baseMap,
                    varioWindowSec,
                    showClimbPhases,
                    showClimbLinesOnChart,
                    showThermalsOnMap,
                };
            },
        }
    )
);
