// src/features/flights/store/timeWindow.store.ts
import { create } from "zustand";
import { throttle } from "lodash";

export type TimeWindow = { startSec: number; endSec: number; totalSec: number };

type TimeWindowState = {
    window: TimeWindow | null;
    // Sofortiger Update (für UI/Slider-Zahlen)
    setWindow: (w: TimeWindow | null) => void;
    // Gedrosselter Update (für teure Berechnungen/ECharts)
    setWindowThrottled: (w: TimeWindow | null) => void;
};

export const useTimeWindowStore = create<TimeWindowState>((set) => {
    // 1. Erstelle die gedrosselte Funktion (alle 200ms)
    const throttledSet = throttle(
        (w: TimeWindow | null) => {
            set({ window: w });
        },
        100,
        { leading: true, trailing: true } // Wichtig für sofortigen Start & finalen Wert
    );

    return {
        window: null,

        // Normaler Setter (falls benötigt)
        setWindow: (w) => set({ window: w }),

        // 2. Diese Methode rufst du im Slider 'onChange' auf
        setWindowThrottled: (w) => throttledSet(w),
    };
});