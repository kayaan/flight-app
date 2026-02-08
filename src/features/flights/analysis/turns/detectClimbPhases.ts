import type { FixPoint } from "../../igc";

export type ClimbPhase = {
    startIdx: number;
    endIdx: number;

    startAltM: number;
    peakAltM: number;
    endAltM: number;

    gainM: number;
    dropFromPeakM: number;

    // optional helpers
    peakIdx: number;
};

export type ClimbDetectConfig = {
    /** segment is only valid if total gain >= this */
    minGainM: number;

    /** segment candidate becomes "active" once gain from start reaches this */
    startGainM: number;

    /** end segment if we drop from peak by at least this many meters */
    dropAbsM: number;

    /** also end segment if we drop below peak*(1-dropPct) (useful for large climbs) */
    dropPct: number; // e.g. 0.10 = 10%

    /** reject tiny segments by point count */
    minLenPts: number;
};

export const defaultClimbDetectConfig: ClimbDetectConfig = {
    minGainM: 50,
    startGainM: 15,
    dropAbsM: 40,
    dropPct: 0.10,
    minLenPts: 25,
};

export function detectClimbPhases(
    fixes: FixPoint[],
    cfg: Partial<ClimbDetectConfig> = {}
): ClimbPhase[] {
    const c: ClimbDetectConfig = { ...defaultClimbDetectConfig, ...cfg };
    if (!fixes || fixes.length < 3) return [];

    const out: ClimbPhase[] = [];

    let inSeg = false;
    let startIdx = 0;
    let startAlt = fixes[0].altitudeM;

    let peakIdx = 0;
    let peakAlt = startAlt;

    const endIfDropBeyond = (alt: number) => {
        const pctThreshold = peakAlt * (1 - c.dropPct);
        const absThreshold = peakAlt - c.dropAbsM;
        // end if below either threshold (i.e. significant drop)
        return alt < absThreshold || alt < pctThreshold;
    };

    for (let i = 1; i < fixes.length; i++) {
        const alt = fixes[i].altitudeM;

        if (!Number.isFinite(alt)) continue;

        if (!inSeg) {
            // Candidate start is current startIdx/startAlt.
            // Activate segment only once we have a real upward move from start.
            if (alt - startAlt >= c.startGainM) {
                inSeg = true;
                peakAlt = alt;
                peakIdx = i;
            } else {
                // Keep moving start forward to avoid anchoring to stale lows/highs.
                // Heuristic: if we go lower than startAlt, reset baseline.
                if (alt < startAlt) {
                    startIdx = i;
                    startAlt = alt;
                }
            }
            continue;
        }

        // in segment: track peak
        if (alt > peakAlt) {
            peakAlt = alt;
            peakIdx = i;
        }

        // check end condition: big drop from peak
        if (endIfDropBeyond(alt)) {
            const endIdx = i;

            const endAlt = fixes[endIdx].altitudeM;
            const gainM = peakAlt - startAlt;
            const lenPts = endIdx - startIdx + 1;

            if (gainM >= c.minGainM && lenPts >= c.minLenPts) {
                out.push({
                    startIdx,
                    endIdx,
                    startAltM: startAlt,
                    peakAltM: peakAlt,
                    endAltM: endAlt,
                    gainM,
                    dropFromPeakM: peakAlt - endAlt,
                    peakIdx,
                });
            }

            // reset for next segment:
            // new baseline begins at current point (we are after a drop)
            inSeg = false;
            startIdx = i;
            startAlt = alt;
            peakIdx = i;
            peakAlt = alt;
        }
    }

    // Optional: tail segment (if we end while still "in segment")
    if (inSeg) {
        const endIdx = fixes.length - 1;
        const endAlt = fixes[endIdx].altitudeM;
        const gainM = peakAlt - startAlt;
        const lenPts = endIdx - startIdx + 1;

        if (gainM >= c.minGainM && lenPts >= c.minLenPts) {
            out.push({
                startIdx,
                endIdx,
                startAltM: startAlt,
                peakAltM: peakAlt,
                endAltM: endAlt,
                gainM,
                dropFromPeakM: peakAlt - endAlt,
                peakIdx,
            });
        }
    }

    return out;
}
