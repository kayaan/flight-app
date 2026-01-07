import { Modal } from "@mantine/core";
import { useCloseLoginModal, useLoginModalOpen } from "../../../store/ui.selectors";
import { LoginForm } from "./LoginForm";


export function LoginModal() {

    const open = useLoginModalOpen();
    const close = useCloseLoginModal();

    return (
        <Modal
            opened={open}
            onClose={close}
            title="Login"
            centered
        >
            <LoginForm onSuccess={close} />
        </Modal>
    )
}