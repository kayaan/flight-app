// src/features/flights/storage/flights.repo.ts
import type { FlightRecordDetails } from "../flights.types";
import { openDb, STORE_FLIGHTS, IDX_FILE_HASH } from "./db";

export type FlightMeta = Omit<FlightRecordDetails, "igcContent"> & { igcContent?: never };

export async function listFlightsMeta(): Promise<FlightMeta[]> {
    const db = await openDb();
    return await reqToPromise<FlightMeta[]>(
        db.transaction(STORE_FLIGHTS, "readonly").objectStore(STORE_FLIGHTS).getAll()
    );
}

export async function getFlightMetaById(id: number): Promise<FlightMeta | null> {
    const db = await openDb();
    const v = await reqToPromise<FlightMeta | undefined>(
        db.transaction(STORE_FLIGHTS, "readonly").objectStore(STORE_FLIGHTS).get(id)
    );
    return v ?? null;
}

export async function getFlightMetaByFileHash(fileHash: string): Promise<FlightMeta | null> {
    const db = await openDb();
    const store = db.transaction(STORE_FLIGHTS, "readonly").objectStore(STORE_FLIGHTS);
    const idx = store.index(IDX_FILE_HASH);
    const v = await reqToPromise<FlightMeta | undefined>(idx.get(fileHash));
    return v ?? null;
}

export async function insertFlightMeta(meta: FlightMeta): Promise<number> {
    const db = await openDb();
    const store = db.transaction(STORE_FLIGHTS, "readwrite").objectStore(STORE_FLIGHTS);
    const id = await reqToPromise<IDBValidKey>(store.add(meta as any));
    return Number(id);
}

export async function deleteFlightMeta(id: number): Promise<void> {
    const db = await openDb();
    const store = db.transaction(STORE_FLIGHTS, "readwrite").objectStore(STORE_FLIGHTS);
    await reqToPromise(store.delete(id));
}

export async function clearFlightsMeta(): Promise<void> {
    const db = await openDb();
    const store = db.transaction(STORE_FLIGHTS, "readwrite").objectStore(STORE_FLIGHTS);
    await reqToPromise(store.clear());
}

function reqToPromise<T>(req: IDBRequest): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    });
}
