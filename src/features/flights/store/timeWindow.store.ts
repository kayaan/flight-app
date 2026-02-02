// src/features/flights/store/timeWindow.store.ts
import { create } from "zustand";
import { throttle } from "lodash";

export type TimeWindow = { startSec: number; endSec: number; totalSec: number };
export type IndexRange = { from: number; to: number };

type TimeWindowState = {
    window: TimeWindow | null;
    // Namen weglassen, nur Typen zählen
    setWindow: (window: TimeWindow | null) => void;
    setWindowThrottled: (window: TimeWindow | null) => void;

    isDragging: boolean;
    setDragging: (v: boolean) => void;
};

export const useTimeWindowStore = create<TimeWindowState>((set) => {
    const throttledSet = throttle(
        (w: TimeWindow | null) => {
            set({ window: w });
        },
        100,
        { leading: true, trailing: true }
    );

    return {
        window: null,

        // Direkte Zuweisung ohne redundante (w) => ... Funktion
        setWindow: (window) => set({ window }),
        setWindowThrottled: throttledSet,

        ran


        isDragging: false,
        setDragging: (v) => set({ isDragging: v })
    };
});
