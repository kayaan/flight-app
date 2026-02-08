import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { WindConfig } from "./wind.types";

type WindConfigState = {
    config: WindConfig;

    setConfig: (partial: Partial<WindConfig>) => void;
    resetConfig: () => void;
};

const defaultConfig: WindConfig = {
    airspeedKmh: 38,              // typical trim speed
    windowSec: 60,                // analysis window for method A
    minSideSamples: 8,            // per side for 180° method
    oppositionToleranceDeg: 25,   // allowed deviation from 180°
    minGroundSpeedMs: 5,          // filter slow/noisy segments
};

export const useWindConfigStore = create<WindConfigState>()(
    persist(
        (set) => ({
            config: defaultConfig,

            setConfig: (partial) =>
                set((state) => ({
                    config: { ...state.config, ...partial },
                })),

            resetConfig: () =>
                set({
                    config: defaultConfig,
                }),
        }),
        {
            name: "wind-config-storage", // localStorage key
        }
    )
);
