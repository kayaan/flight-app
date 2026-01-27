// src/features/flights/service/flights.local.service.ts
import type { FlightRecordDetails } from "../flights.types";
import type { FlightMeta } from "../storage/flights.repo";
import { getFlightMetaByFileHash } from "../storage/flights.repo";
import { withTx, STORE_FLIGHTS, STORE_IGC } from "../storage/db";
import { hashFileSha256 } from "../igc/fileHash";

// OPTIONAL: wenn du schon Parser/Builder hast, häng sie hier rein.
// import { parseIgcFixes } from "../igc/igc.series";




export type UploadManyResult = {
    inserted: FlightRecordDetails[];
    skipped: Array<{ originalFilename: string; reason: "duplicate" }>;
};

export async function uploadOneLocal(file: File): Promise<{ flight: FlightRecordDetails; wasDuplicate: boolean }> {
    const igcContent = await file.text();
    const fileHash = await hashFileSha256(file);

    // dedupe (outside tx is ok, but we also rely on unique index)
    const existing = await getFlightMetaByFileHash(fileHash);
    if (existing) {
        // return existing as "duplicate" (and leave igcContent to be loaded by getFlightById if needed)
        const flight: FlightRecordDetails = { ...(existing as any), igcContent: null };
        return { flight, wasDuplicate: true };
    }

    const uploadedAt = new Date().toISOString();

    // Minimal meta derivation (du kannst später mehr aus Header/Metrics füllen)
    const meta = deriveMetaFromIgcMinimal({
        fileHash,
        uploadedAt,
        originalFilename: file.name ?? null,
        igcContent,
    });

    const inserted = await withTx([STORE_FLIGHTS, STORE_IGC], "readwrite", async (tx) => {
        const flightsStore = tx.objectStore(STORE_FLIGHTS);
        const newIdKey = await reqToPromise<IDBValidKey>(flightsStore.add(meta as any));
        const id = Number(newIdKey);

        const full: FlightRecordDetails = { ...(meta as any), id, igcContent };
        const igcStore = tx.objectStore(STORE_IGC);
        await reqToPromise(igcStore.put({ flightId: id, igcContent }));

        return full;
    });

    return { flight: inserted, wasDuplicate: false };
}

export async function uploadManyLocal(files: File[]): Promise<UploadManyResult> {
    const inserted: FlightRecordDetails[] = [];
    const skipped: Array<{ originalFilename: string; reason: "duplicate" }> = [];

    for (const f of files) {
        const res = await uploadOneLocal(f);
        if (res.wasDuplicate) {
            skipped.push({ originalFilename: f.name ?? "(unknown)", reason: "duplicate" });
        } else {
            inserted.push(res.flight);
        }
    }
    return { inserted, skipped };
}

function deriveMetaFromIgcMinimal(args: {
    fileHash: string;
    uploadedAt: string;
    originalFilename: string | null;
    igcContent: string;
}): FlightMeta {
    // TODO: hier kannst du später richtig parsen:
    // - Header: pilotName, gliderType, ...
    // - fixes: takeoff/landing aus B-Records
    // - metrics: durationSeconds, distanceKm, altitudes, vario, fixCount etc.
    // Für jetzt: nulls + uploadedAt, fileHash, filename

    const meta: any = {
        // Primary keys & ownership
        id: 0, // will be overwritten by IndexedDB autoIncrement result
        userId: 1,

        // Dedupe / metadata
        fileHash: args.fileHash,
        uploadedAt: args.uploadedAt,

        // File info
        originalFilename: args.originalFilename,

        // Header metadata
        pilotName: null,
        gliderType: null,
        gliderRegistration: null,
        gliderCallsign: null,
        flightDate: null,
        loggerModel: null,

        // LXNAV-specific fields
        lxDeviceJwt: null,
        lxActivityId: null,
        isVerified: false,

        // Timing
        takeoffTime: null,
        landingTime: null,

        // Metrics
        durationSeconds: null,
        distanceKm: null,
        maxAltitudeM: null,
        minAltitudeM: null,
        maxClimbRateMs: null,
        maxSinkRateMs: null,
        avgClimbRateMs: null,
        fixCount: null,

        // Visibility
        visibility: "private",
    } satisfies Omit<FlightRecordDetails, "igcContent">;

    // IMPORTANT: igcContent is not stored in flights store
    return meta as FlightMeta;
}

function reqToPromise<T>(req: IDBRequest): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    });
}
