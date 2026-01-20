import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/about')({
    component: () => <div style={{ border: "2px solid red" }}>about
    </div>,
})
