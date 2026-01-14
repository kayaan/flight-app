export interface FlightRecordDetails {
    // --- Metadaten & Keys ---
    id: number;
    userId: number;
    fileHash: string;
    uploadedAt: string;
    /** Der ursprüngliche Name der hochgeladenen Datei */
    originalFilename: string;

    // --- Header Informationen ---
    pilotName: string;
    gliderType: string;
    gliderRegistration: string;
    gliderCallsign: string;
    flightDate: string;
    loggerModel: string;

    // --- LXNAV Spezifika ---
    lxDeviceJwt: string | null;
    lxActivityId: string | null;
    isVerified: boolean;

    // --- Flugstatistiken ---
    takeoffTime: string | null;
    landingTime: string | null;
    durationSeconds: number;
    maxAltitude: number;
    distanceKm: number;

    // --- Status & Sichtbarkeit ---
    visibility: 'private' | 'public' | 'club';
}