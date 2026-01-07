import { useState } from "react";
import { loginWithEmail } from "../store/auth.action";


export function LoginForm() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')

    const [error, setError] = useState<string | null>(null)

    async function handleSubmit(e: React.FormEvent) {

        e.preventDefault()
        setError(null);

        try {
            await loginWithEmail(email, password)
        } catch (err: unknown) {
            if (err instanceof Error)
                setError(err.message ?? 'Login fehlgeschlagen')
            else {
                setError('Login fehlgeschlagen')
            }
        }
    }

    return (
        <form onSubmit={handleSubmit}>
            <input
                value={email}
                onChange={e => setEmail(e.target.value)} />
            <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
            />

            <button type="submit">Login</button>

            {error && <p>{error}</p>}
        </form>
    )
}