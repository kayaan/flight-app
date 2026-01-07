import { authApi } from "../api/auth.api";
import { useAuthStore } from "./auth.store";

export async function loginWithEmail(
    email: string,
    password: string
) {
    const res = await authApi.login({ email, password })

    useAuthStore.getState().login(res.token, res.user);
}