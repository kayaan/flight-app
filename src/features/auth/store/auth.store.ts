import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "../api/auth.types";

interface AuthState {
    token: string | null;
    user: User | null;

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
                }),
            logout: () =>
                set({
                    token: null,
                    user: null,
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