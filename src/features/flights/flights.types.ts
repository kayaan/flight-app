export interface FlightRecordDetails {
    // Primary keys & ownership
    id: number;
    userId: number;

    // Dedupe / metadata
    fileHash: string;
    uploadedAt: string; // ISO-8601 timestamp

    igcContent: string | null;

    // File info
    originalFilename: string | null;

    // Header metadata
    pilotName: string | null;
    gliderType: string | null;
    gliderRegistration: string | null;
    gliderCallsign: string | null;
    flightDate: string | null;
    loggerModel: string | null;

    // LXNAV-specific fields
    lxDeviceJwt: string | null;
    lxActivityId: string | null;
    isVerified: boolean;

    // Timing
    takeoffTime: string | null;
    landingTime: string | null;

    // Metrics
    durationSeconds: number | null;
    distanceKm: number | null;

    maxAltitudeM: number | null;
    minAltitudeM: number | null;

    maxClimbRateMs: number | null;
    maxSinkRateMs: number | null;
    avgClimbRateMs: number | null;

    fixCount: number | null;

    // Visibility / access control
    visibility: 'private' | 'public' | 'club';
}

export type RemoveResult = { id: number };

export interface GPSPoint {
    tSec: number;
    tAbsSec: number;
    lat: number;
    lng: number;
    alt: number;
}


export interface FlightRecord extends FlightRecordDetails {

    igcContent: string;

}
