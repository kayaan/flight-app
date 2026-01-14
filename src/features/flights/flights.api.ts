import request from "../auth/api/auth.api"
import type { FlightRecordDetails } from "./flights.types"

export type FlightListItem = { id: number }

export type Flight = {
    id: number,
    user_id: number,
    igc_content: string
}

export const flightApi = {

    list(token: string): Promise<FlightRecordDetails[]> {
        return request<FlightRecordDetails[]>(
            '/api/flights',
            { method: "GET", token })

    },

    get(id: number, token: string): Promise<FlightRecordDetails> {
        return request<FlightRecordDetails>(
            `/api/flights/${id}`,
            { method: "GET", token })
    },

    remove(id: number, token: string) {
        return request<FlightListItem>(
            `/api/flights/${id}`,
            { method: "DELETE", token })
    },

    upload(file: File, token: string): Promise<FlightRecordDetails> {
        const formData = new FormData();
        formData.append('file', file);

        return request<FlightRecordDetails>(
            '/api/flights',
            {
                method: "POST",
                token,
                body: formData
            }
        )
    },

    uploadMany(files: File[], token: string): Promise<{
        inserted: FlightRecordDetails[];
        skipped: Array<{ originalFilename: string; reason: 'duplicate' }>;
    }> {
        const formData = new FormData();

        for (const file of files) formData.append('files', file);

        return request<{
            inserted: FlightRecordDetails[];
            skipped: Array<{ originalFilename: string; reason: 'duplicate' }>;
        }>(
            '/api/flights',
            {
                method: 'POST',
                token,
                body: formData
            }
        )
    },


    deleteAll(token: string | null): Promise<void> {
        return request<void>(
            '/api/flights/deleteall',
            {
                method: 'DELETE',
                token
            }
        )
    }
}