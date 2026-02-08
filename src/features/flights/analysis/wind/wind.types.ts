export type WindEstimateMethod = "window" | "opposite180";

export type WindEstimate = {
    // Which estimation strategy produced this result
    method: WindEstimateMethod;

    // Direction the wind is blowing TO (drift direction)
    // 0° = North, 90° = East
    dirDeg: number;

    // Wind speed in meters per second
    speedMs: number;

    // Rough confidence score (0..1)
    quality: number;

    // Number of samples used for estimation
    sampleCount: number;
};

export type WindConfig = {
    // Assumed glider airspeed (trim speed) in km/h
    airspeedKmh: number;

    // Length of analysis window in seconds (for window-based method)
    windowSec: number;

    // For 180° opposite-heading method:
    // minimum required samples per side
    minSideSamples: number;

    // Allowed deviation from perfect 180° opposition (degrees)
    oppositionToleranceDeg: number;

    // Ignore samples below this ground speed (m/s) to reduce GPS noise
    minGroundSpeedMs: number;
};
