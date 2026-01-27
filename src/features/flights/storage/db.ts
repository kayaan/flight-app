// src/features/flights/storage/db.ts
export const DB_NAME = "flyapp";
export const DB_VERSION = 1;

export const STORE_FLIGHTS = "flights";
export const STORE_IGC = "igc";

// Flights store indices
export const IDX_FILE_HASH = "fileHash";
export const IDX_UPLOADED_AT = "uploadedAt";
export const IDX_FLIGHT_DATE = "flightDate";
export const IDX_USER_ID = "userId";

let _dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
    if (_dbPromise) return _dbPromise;

    _dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = () => {
            const db = req.result;

            // flights: meta only (no igcContent)
            if (!db.objectStoreNames.contains(STORE_FLIGHTS)) {
                const flights = db.createObjectStore(STORE_FLIGHTS, {
                    keyPath: "id",
                    autoIncrement: true,
                });

                flights.createIndex(IDX_FILE_HASH, "fileHash", { unique: true });
                flights.createIndex(IDX_UPLOADED_AT, "uploadedAt", { unique: false });
                flights.createIndex(IDX_FLIGHT_DATE, "flightDate", { unique: false });
                flights.createIndex(IDX_USER_ID, "userId", { unique: false });
            }

            // igc: key = flightId
            if (!db.objectStoreNames.contains(STORE_IGC)) {
                db.createObjectStore(STORE_IGC, { keyPath: "flightId" });
            }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
    });

    return _dbPromise;
}

export async function withTx<T>(
    storeNames: string[],
    mode: IDBTransactionMode,
    fn: (tx: IDBTransaction) => Promise<T> | T
): Promise<T> {
    const db = await openDb();
    const tx = db.transaction(storeNames, mode);

    try {
        const result = await fn(tx);
        await txDone(tx);
        return result;
    } catch (e) {
        try { tx.abort(); } catch { }
        throw e;
    }
}

function txDone(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB tx failed"));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB tx aborted"));
    });
}
