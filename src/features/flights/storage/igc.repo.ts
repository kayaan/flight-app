// src/features/flights/storage/igc.repo.ts
import { openDb, STORE_IGC } from "./db";

type IgcRow = { flightId: number; igcContent: string };

export async function getIgcContentByFlightId(flightId: number): Promise<string | null> {
    const db = await openDb();
    const row = await reqToPromise<IgcRow | undefined>(
        db.transaction(STORE_IGC, "readonly").objectStore(STORE_IGC).get(flightId)
    );
    return row?.igcContent ?? null;
}

export async function putIgcContent(flightId: number, igcContent: string): Promise<void> {
    const db = await openDb();
    const store = db.transaction(STORE_IGC, "readwrite").objectStore(STORE_IGC);
    await reqToPromise(store.put({ flightId, igcContent } satisfies IgcRow));
}

export async function deleteIgcByFlightId(flightId: number): Promise<void> {
    const db = await openDb();
    const store = db.transaction(STORE_IGC, "readwrite").objectStore(STORE_IGC);
    await reqToPromise(store.delete(flightId));
}

export async function clearIgc(): Promise<void> {
    const db = await openDb();
    const store = db.transaction(STORE_IGC, "readwrite").objectStore(STORE_IGC);
    await reqToPromise(store.clear());
}

function reqToPromise<T>(req: IDBRequest): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    });
}
