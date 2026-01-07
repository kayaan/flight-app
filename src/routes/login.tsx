import { createFileRoute } from "@tanstack/react-router";
import { LoginForm } from "../features/auth/ui/LoginForm";

export const Route = createFileRoute("/login")({
    component: LoginPage,
});

function LoginPage() {
    return LoginForm({
        onSuccess: () => { }
    });
}
