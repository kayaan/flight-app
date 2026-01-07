import { useAuthStore } from "./auth.store";


export const useIsAuthenticated = () =>
    useAuthStore((state) => Boolean(state.token))


export const useAuthUser = () =>
    useAuthStore((state) => state.user)