
import { create } from "zustand";


type LoginReason = 'auth-required' | 'manual' | null;

interface UiState {
    loginModalOpen: boolean;
    loginReason: LoginReason;
    openLoginModal: (reason?: Exclude<LoginReason, null>) => void;
    closeLoginModal: () => void;
}

export const useUiStore = create<UiState>((set) => ({
    loginModalOpen: false,
    loginReason: null,

    openLoginModal: (reason = 'manual') =>
        set({
            loginModalOpen: true,
            loginReason: reason
        }),
    closeLoginModal: () => set({
        loginModalOpen: false,
        loginReason: null
    })
}))