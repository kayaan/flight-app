import { create } from "zustand"


type AuthState = {
    user: { email: string } | null
    token: string | null
    login: (email: string, token: string) => void
    logout: () => void
}

export const useAuthStore = create<AuthState>(set => ({
    user: null,
    token: null,
    login: (email, token) =>
        set({ user: { email }, token }),
    logout: () =>
        set({ user: null, token: null }),
}))
