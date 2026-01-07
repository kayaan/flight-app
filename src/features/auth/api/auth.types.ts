export type LoginRequest = {
    email: string;
    password: string;
}

export type ApiError = {
    status: number;
    message: string;
    details: unknown;
}

export interface User {
    id: number;
    firstname: string;
    lastname: string;
    email: string;
    role: UserRole;
}

export type UserRole = 'user' | 'admin';

