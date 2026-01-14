import { useState } from "react";
import { loginWithEmail } from "../store/auth.action";

import { Alert, Button, Group, PasswordInput, Stack, TextInput } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";

type Props = {
    onSuccess?: () => void;
};


export function LoginForm({ onSuccess }: Props) {

    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')

    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false);

    const emailOk = email.trim().length > 3 && email.includes("@");
    const passwordOk = password.length >= 6;
    const canSubmit = emailOk && passwordOk && !loading;

    async function handleSubmit(e: React.FormEvent) {

        e.preventDefault()
        setError(null);
        setLoading(true);

        try {
            await loginWithEmail(email, password);
            onSuccess?.();
        } catch {
            setError("Login fehlgeschlagen. Bitte prüfe E-Mail/Passwort.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <form onSubmit={handleSubmit}>
            <Stack gap="sm">
                {error && (
                    <Alert icon={<IconAlertCircle size={16} />} title="Fehler" color="red">
                        {error}
                    </Alert>
                )}

                <TextInput
                    label="E-Mail"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.currentTarget.value)}
                    required
                    autoComplete="email"
                />

                <PasswordInput
                    label="Passwort"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.currentTarget.value)}
                    required
                    autoComplete="current-password"
                />
                <Group justify="space-between" mt="xs">
                    <Button type="submit" loading={loading} disabled={!canSubmit}>
                        Einloggen
                    </Button>

                    {/* optional: später "Passwort vergessen" */}
                    {/* <Anchor size="sm" component="button" type="button">Passwort vergessen?</Anchor> */}
                </Group>
            </Stack>
        </form>
    )
}