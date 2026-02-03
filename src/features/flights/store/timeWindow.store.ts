// src/features/flights/store/timeWindow.store.ts
import { create } from "zustand";
import { throttle } from "lodash";

export type TimeWindow = { startSec: number; endSec: number; totalSec: number };
export type IndexRange = { from: number; to: number };

type TimeWindowState = {
    // ✅ alt: bleibt
    window: TimeWindow | null;
    setWindow: (window: TimeWindow | null) => void;
    setWindowThrottled: (window: TimeWindow | null) => void;

    // ✅ neu: zusätzlich
    range: IndexRange | null;
    setRange: (range: IndexRange | null, opts: { maxIndex: number }) => void;
    setRangeThrottled: (range: IndexRange | null, opts: { maxIndex: number }) => void;

    isDragging: boolean;
    setDragging: (v: boolean) => void;
};

function normalizeClamp(r: IndexRange, maxIndex: number): IndexRange {
    const a = Math.min(r.from, r.to);
    const b = Math.max(r.from, r.to);
    const from = Math.max(0, Math.min(a, maxIndex));
    const to = Math.max(0, Math.min(b, maxIndex));
    return from <= to ? { from, to } : { from: to, to: from };
}

function sameRange(a: IndexRange | null, b: IndexRange | null) {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return a.from === b.from && a.to === b.to;
}

export const useTimeWindowStore = create<TimeWindowState>((set, get) => {
    const throttledSetWindow = throttle(
        (w: TimeWindow | null) => set({ window: w }),
        100,
        { leading: true, trailing: true }
    );

    const applySetRange = (range: IndexRange | null, opts: { maxIndex: number }) => {
        const next = range ? normalizeClamp(range, opts.maxIndex) : null;
        const prev = get().range;
        if (sameRange(prev, next)) return;
        set({ range: next });
    };

    const throttledSetRange = throttle(
        (r: IndexRange | null, opts: { maxIndex: number }) => applySetRange(r, opts),
        100,
        { leading: true, trailing: true }
    );

    return {
        window: null,
        setWindow: (window) => set({ window }),
        setWindowThrottled: throttledSetWindow,

        range: null,
        setRange: applySetRange,
        setRangeThrottled: throttledSetRange,

        isDragging: false,
        setDragging: (v) => set({ isDragging: v }),
    };
});
