import * as React from "react";
import type { WindEstimate, WindConfig } from "./wind.types";
import { estimateWindFromWindow } from "./wind.estimate.window";
import { estimateWindFromOpposite180 } from "./wind.estimate.opposite180";

type WindFix = {
    tSec: number;
    lat: number;
    lon: number;
};

type WindRange = {
    startSec: number;
    endSec: number;
} | null;

export type WindEstimates = {
    window: WindEstimate | null;
    opposite180: WindEstimate | null;
};

/**
 * Compute wind estimates for a given range.
 * If range is null, we use the full flight (0..lastFix.tSec).
 */
export function useWindEstimate(
    fixes: WindFix[],
    range: WindRange,
    config: WindConfig
): WindEstimates {
    const startSec = range?.startSec ?? 0;
    const endSec = range?.endSec ?? (fixes.length ? fixes[fixes.length - 1].tSec : 0);

    return React.useMemo(() => {
        if (fixes.length < 2) return { window: null, opposite180: null };

        const windowEst = estimateWindFromWindow(fixes, startSec, endSec, config);
        const opposite180 = estimateWindFromOpposite180(fixes, startSec, endSec, config);

        return { window: windowEst, opposite180 };
    }, [fixes, startSec, endSec, config]);
}
