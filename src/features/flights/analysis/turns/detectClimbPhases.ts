export type FixPoint = {
    tSec: number;
    iso: string;
    lat: number;
    lon: number;
    altitudeM: number;
};

export type ClimbPhase = {
    startIdx: number;
    endIdx: number; // endet am Peak
    startAltM: number;
    peakAltM: number;
    gainM: number;
    peakIdx: number;
};

export type ClimbDetectConfig = {
    /** Segment wird erst aktiv, wenn Gain vom Start >= startGainM */
    startGainM: number;

    /** Segment wird nur behalten, wenn Gain >= minGainM */
    minGainM: number;

    /**
     * Drop-Kriterium als Anteil des Segment-Gains:
     * dropM = (peakAlt - startAlt) * dropPct
     * Ende wenn currentAlt <= peakAlt - dropM
     *
     * Beispiel: start 1700, peak 2300 => gain 600
     * dropPct 0.10 => dropM 60 => Ende bei <= 2240
     */
    dropPct: number; // z.B. 0.10

    /** Optional: Mindest-Drop in Metern (gegen winzige Gains). */
    minDropAbsM: number; // z.B. 25..60

    /** Optional gegen Mikrosequenzen: min. Anzahl Punkte */
    minLenPts: number;
};

export const defaultClimbDetectConfig: ClimbDetectConfig = {
    startGainM: 15,
    minGainM: 50,
    dropPct: 0.10,
    minDropAbsM: 40,
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

    const dropThresholdAlt = () => {
        const gain = Math.max(0, peakAlt - startAlt);
        const dropM = Math.max(c.minDropAbsM, gain * c.dropPct);
        return peakAlt - dropM;
    };

    for (let i = 1; i < fixes.length; i++) {
        const alt = fixes[i].altitudeM;
        if (!Number.isFinite(alt)) continue;

        if (!inSeg) {
            // Segment aktivieren erst bei echtem Anstieg
            if (alt - startAlt >= c.startGainM) {
                inSeg = true;
                peakIdx = i;
                peakAlt = alt;
            } else {
                // Baseline nach unten nachziehen
                if (alt < startAlt) {
                    startIdx = i;
                    startAlt = alt;
                }
            }
            continue;
        }

        // Peak updaten
        if (alt > peakAlt) {
            peakAlt = alt;
            peakIdx = i;
        }

        // ✅ Abbruch: Drop relativ zum Segment-Gain (plus minDropAbsM)
        if (alt <= dropThresholdAlt()) {
            // Segment endet am Peak
            const endIdx = peakIdx;
            const gainM = peakAlt - startAlt;
            const lenPts = endIdx - startIdx + 1;

            if (gainM >= c.minGainM && lenPts >= c.minLenPts) {
                out.push({
                    startIdx,
                    endIdx,
                    startAltM: startAlt,
                    peakAltM: peakAlt,
                    gainM,
                    peakIdx,
                });
            }

            // Peak-Backtracking: neu am Peak starten
            inSeg = false;
            startIdx = peakIdx;
            startAlt = peakAlt;

            peakIdx = startIdx;
            peakAlt = startAlt;

            // (wir laufen bei i weiter; baseline kann durch weitere Drops weiter runtergezogen werden)
        }
    }

    // Tail: Segment endet am Peak
    if (inSeg) {
        const endIdx = peakIdx;
        const gainM = peakAlt - startAlt;
        const lenPts = endIdx - startIdx + 1;

        if (gainM >= c.minGainM && lenPts >= c.minLenPts) {
            out.push({
                startIdx,
                endIdx,
                startAltM: startAlt,
                peakAltM: peakAlt,
                gainM,
                peakIdx,
            });
        }
    }

    return out;
}
