import { createFileRoute } from "@tanstack/react-router";
import { useAuthStore } from "../features/auth/store/auth.store";
import { useUiStore } from "../store/ui.store";
import { useAuthUser, useIsAuthenticated } from "../features/auth/store/auth.selector";
import { Button } from "@mantine/core";
import { useOpenLoginModal } from "../store/ui.selectors";


export const Route = createFileRoute("/personal")({
    beforeLoad: () => {
        const auth = useAuthStore.getState();
        const isAuthed = Boolean(auth.token);

        if (!isAuthed) {
            const ui = useUiStore.getState();
            if (!ui.loginModalOpen) {
                ui.openLoginModal("auth-required");
            }
        }
    },
    component: PersonalPage
})

function PersonalPage() {
    const isAuthenticated = useIsAuthenticated();
    const openLoginModal = useOpenLoginModal();
    const user = useAuthUser();

    if (!isAuthenticated) {

        return (
            <div style={{ padding: 16 }}>
                <h2>Personal Information</h2>
                <p>Bitte einloggen, um diese Seite zu sehen.</p>
                <Button onClick={() => openLoginModal("manual")}>Login</Button>
            </div>
        );
    }


    return (
        <div style={{ padding: 16 }}>
            <h2>Personal Information</h2>

            <div style={{ marginTop: 12 }}>
                <div>
                    <strong>Name:</strong> {user?.firstname} {user?.lastname}
                </div>
                <div>
                    <strong>Email:</strong> {user?.email}
                </div>
            </div>
        </div>
    );
}
