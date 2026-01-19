// Time series types for flight detail charts

/**
 * One raw fix point parsed from a B-record.
 */
export type FixPoint = {
    /** Seconds since midnight (HH*3600 + MM*60 + SS) */
    tSec: number;

    /** ISO timestamp (flightDate + HH:MM:SS + Z) */
    iso: string;

    /** Latitude in decimal degrees */
    lat: number;

    /** Longitude in decimal degrees */
    lon: number;

    /** Altitude in meters (GNSS preferred, fallback to pressure altitude) */
    altitudeM: number;
};

/**
 * Per-fix time series for line charts (altitude + horizontal speed).
 */
export type SeriesPoint = {
    /** Seconds since takeoff (0 = first fix) */
    tSec: number;

    /** Altitude in meters */
    altitudeM: number;

    /** Horizontal ground speed in km/h (per-fix) */
    gSpeedKmh: number;
};

/**
 * Discrete window-based series (bars).
 */
export type WindowPoint = {
    /** Window end in seconds since takeoff */
    tSec: number;

    /** Vertical speed over the window (m/s, positive = climb, negative = sink) */
    vSpeedMs: number;

    /** Horizontal speed averaged over the same window (km/h) */
    gSpeedKmh: number;
};
