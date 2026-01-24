// src/store/flightHover.store.ts
import { create } from "zustand";
import throttle from "lodash/throttle";

type FlightHoverState = {
    hoverTSec: number | null;
    setHoverTSecThrottled: (t: number | null) => void;
    clearNow: () => void;

    // optional: falls du später flush/cancel brauchst
    flush: () => void;
    cancel: () => void;
};

export const useFlightHoverStore = create<FlightHoverState>((set) => {
    // ⭐ Intervall hier zentral konfigurieren
    const intervalMs = 100;

    // lodash throttle: trailing-only => schreibt nur am Ende des Intervalls den letzten Wert
    const throttledCommit = throttle(
        (t: number | null) => {
            set((s) => {
                if (s.hoverTSec === t) return s; // ✅ bei Gleichheit: nix tun
                return { ...s, hoverTSec: t };
            });
        },
        intervalMs,
        { leading: false, trailing: true }
    );

    return {
        hoverTSec: null,

        // Wird von Charts aufgerufen (häufig)
        setHoverTSecThrottled: (t) => {
            const v = t == null ? null : Math.round(t);
            throttledCommit(v);
        },

        // Sofort löschen + geplante trailing commits stoppen
        clearNow: () => {
            throttledCommit.cancel();
            set({ hoverTSec: null });
        },

        flush: () => throttledCommit.flush(),
        cancel: () => throttledCommit.cancel(),
    };
});
