import { describe, it, expect } from "vitest";
import { parseIgcFixes, buildFlightSeries } from "./igc.series";

// Tiny fake IGC with 3 B-records, altitude increases then decreases
const IGC_SAMPLE = `
AXXXTEST
HFDTE010126
B1200004807123N01131234EA0100001000
B1200054807123N01131235EA0105001010
B1200104807123N01131236EA0100001005
`.trim();

// Flight date from header (YYYY-MM-DD)
const FLIGHT_DATE = "2026-01-01";

describe("IGC series builder", () => {
    it("parses fixes and builds windowed series", () => {
        const fixes = parseIgcFixes(IGC_SAMPLE, FLIGHT_DATE);
        expect(fixes.length).toBeGreaterThan(0);

        const { series, windows } = buildFlightSeries(fixes, 5);

        // We should have per-fix series
        expect(series.length).toBe(fixes.length);

        // And at least one window
        expect(windows.length).toBeGreaterThan(0);

        // First window should reflect climb (positive vSpeed)
        expect(windows[0].vSpeedMs).toBeGreaterThan(0);
    });
});
