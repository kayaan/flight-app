import { create } from "zustand";
import { persist } from "zustand/middleware";


export type UserRole = 'user' | 'admin';

export interface User {
    id: number;
    firstname: string;
    lastname: string;
    email: string;
    role: UserRole;
}


interface AuthState {
    token: string | null;
    user: User | null;
    isAuthenticated: boolean;

    login: (token: string, user: User) => void;
    logout: () => void;
}

/* eslint-disable @typescript-eslint/no-unused-vars */
export const useAuthStore = create<AuthState>()(
    persist(
        (set, get) => ({
            token: null,
            user: null,
            isAuthenticated: false,
            login: (token, user) =>
                set({
                    token,
                    user,
                    isAuthenticated: true,
                }),
            logout: () =>
                set({
                    token: null,
                    user: null,
                    isAuthenticated: false
                })
        }),
        {
            name: 'auth-storage',
            partialize: (state) => ({
                token: state.token,
                user: state.user,
            })

        }
    )



)