// src/features/flights/flights.api.local.ts

import { listFlightsMeta, getFlightMetaById } from "./storage/flights.repo";
import { getIgcContentByFlightId } from "./storage/igc.repo";
import { withTx, STORE_FLIGHTS, STORE_IGC } from "./storage/db";
import { uploadManyLocal, uploadOneLocal } from "./service/flights.local.service";
import type { FlightRecordDetails, RemoveResult } from "./flights.types";



export const flightApiLocal = {
    async getIgcContent(id: number, _token: string): Promise<string> {
        const igc = await getIgcContentByFlightId(id);
        if (!igc) throw new Error("IGC not found");
        return igc;
    },

    async list(_token: string): Promise<FlightRecordDetails[]> {
        const metas = await listFlightsMeta();
        // uploadedAt DESC
        metas.sort((a, b) => (a.uploadedAt > b.uploadedAt ? -1 : a.uploadedAt < b.uploadedAt ? 1 : 0));
        return metas.map((m) => ({ ...(m as any), igcContent: null }));
    },

    async getFlightById(id: number, _token: string): Promise<FlightRecordDetails> {
        const meta = await getFlightMetaById(id);
        if (!meta) throw new Error("Flight not found");
        const igc = await getIgcContentByFlightId(id);
        return { ...(meta as any), igcContent: igc ?? null };
    },

    async remove(id: number, _token: string): Promise<RemoveResult> {
        await withTx([STORE_FLIGHTS, STORE_IGC], "readwrite", async (tx) => {
            tx.objectStore(STORE_IGC).delete(id);
            tx.objectStore(STORE_FLIGHTS).delete(id);
        });
        return { id };
    },

    async upload(file: File, _token: string): Promise<FlightRecordDetails> {
        const { flight, wasDuplicate } = await uploadOneLocal(file);
        if (wasDuplicate) {
            // policy: return existing meta (igcContent null)
            return flight;
        }
        return flight; // inserted (with igcContent)
    },

    async uploadMany(files: File[], _token: string): Promise<{
        inserted: FlightRecordDetails[];
        skipped: Array<{ originalFilename: string; reason: "duplicate" }>;
    }> {
        return uploadManyLocal(files);
    },

    async deleteAll(_token: string | null): Promise<void> {
        await withTx([STORE_FLIGHTS, STORE_IGC], "readwrite", async (tx) => {
            tx.objectStore(STORE_FLIGHTS).clear();
            tx.objectStore(STORE_IGC).clear();
        });
    },
};
