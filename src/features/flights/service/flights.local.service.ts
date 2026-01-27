// src/features/flights/service/flights.local.service.ts
import type { FlightRecordDetails } from "../flights.types";
import type { FlightMeta } from "../storage/flights.repo";
import { getFlightMetaByFileHash } from "../storage/flights.repo";
import { withTx, STORE_FLIGHTS, STORE_IGC } from "../storage/db";
import { parseIgcFile } from "../igc/igcParser"; // ✅ dein neuer Parser

export type UploadManyResult = {
    inserted: FlightRecordDetails[];
    skipped: Array<{ originalFilename: string; reason: "duplicate" }>;
};

const LOCAL_USER_ID = 1;

export async function uploadOneLocal(
    file: File
): Promise<{ flight: FlightRecordDetails; wasDuplicate: boolean }> {
    const igcContent = await file.text();

    // ✅ Full parse (Meta + Metrics + fileHash) happens here
    const parsed = parseIgcFile(igcContent, LOCAL_USER_ID, file.name ?? "");

    // ✅ dedupe by parser hash (single source of truth)
    const existing = await getFlightMetaByFileHash(parsed.fileHash);
    if (existing) {
        const flight: FlightRecordDetails = { ...(existing as any), igcContent: null };
        return { flight, wasDuplicate: true };
    }

    const inserted = await withTx([STORE_FLIGHTS, STORE_IGC], "readwrite", async (tx) => {
        const flightsStore = tx.objectStore(STORE_FLIGHTS);

        // IMPORTANT: flights store must not store igcContent
        const meta = toFlightMeta(parsed);

        // ✅ FIX: do NOT pass id into an autoIncrement store
        // If your store has keyPath "id" + autoIncrement, "id: 0" breaks autoIncrement.
        const { id: _omitId, igcContent: _omitIgc, ...metaForStore } = meta as any;

        const newIdKey = await reqToPromise<IDBValidKey>(flightsStore.add(metaForStore));
        const id = Number(newIdKey);

        const igcStore = tx.objectStore(STORE_IGC);
        await reqToPromise(igcStore.put({ flightId: id, igcContent }));

        const full: FlightRecordDetails = { ...(meta as any), id, igcContent };
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

function toFlightMeta(parsed: FlightRecordDetails): FlightMeta {
    // Strip igcContent for flights-store (kept in STORE_IGC)
    const { igcContent: _igc, ...meta } = parsed;

    // Ensure id=0 placeholder (IndexedDB autoIncrement will set actual id)
    return { ...(meta as any), id: 0 } as FlightMeta;
}

function reqToPromise<T>(req: IDBRequest): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    });
}
