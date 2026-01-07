import { useUiStore } from "./ui.store";

export const useLoginModalOpen = () => useUiStore((s) => s.loginModalOpen);
export const useOpenLoginModal = () => useUiStore((s) => s.openLoginModal);
export const useCloseLoginModal = () => useUiStore((s) => s.closeLoginModal);