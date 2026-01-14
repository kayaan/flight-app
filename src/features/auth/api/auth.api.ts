import { LoginResponseSchema, UserSchema, type LoginResponse } from "./auth.schemas";
import type { ApiError, LoginRequest, User } from "./auth.types";
import type { ZodType } from 'zod'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function parseJsonSave(res: Response): Promise<any> {
    const text = await res.text();

    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

async function request<T>(
    path: string,
    options: RequestInit & {
        token?: string | null
        schema?: ZodType<T>
    } = {}
) {

    const { token, headers, body, ...rest } = options;;

    const isFormData = body instanceof FormData;


    const res = await fetch(`${API_BASE_URL}${path}`, {
        ...rest,
        body,
        headers: {
            ...(isFormData ? {} : { "Content-Type": "application/json" }),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(headers ?? {}),
        },
    });

    const data = await parseJsonSave(res);

    if (!res.ok) {
        const err: ApiError = {
            status: res.status,
            message:
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (data && typeof data === "object" && "message" in data && (data as any).message) ||
                res.statusText ||
                "Request failed",
            details: data,
        };
        throw err;
    }

    if (options.schema) {
        return options.schema.parse(data);
    }

    return data as T;
}

export const authApi = {
    login(body: LoginRequest) {
        return request<LoginResponse>("/auth/login", {
            method: "POST",
            body: JSON.stringify(body),
            schema: LoginResponseSchema
        });
    },

    me(token: string) {
        // Beispiel-Endpunkt: GET /auth/me
        return request<User>("/auth/me", {
            method: "GET",
            token,
            schema: UserSchema
        });
    },
}

export default request;