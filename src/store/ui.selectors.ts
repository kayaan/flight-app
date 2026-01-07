import { useUiStore } from "./ui.store";

export const useLoginModalOpen = () => {
    useUiStore((s) => s.loginModalOpen)
}

export const useUiActions = () => {
    useUiStore((s) => ({
        openLoginModal: s.openLoginModal,
        closeLoginModal: s.closeLoginModal
    }))
}
