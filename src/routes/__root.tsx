import { createRootRoute, Link, Outlet } from "@tanstack/react-router";


export const Route = createRootRoute({
    component: RootLayout,
})

function RootLayout() {
    return (
        <div>
            <nav style={{ display: 'flex', gap: 12 }}>
                <Link to="/">Home</Link>
                <Link to="/about">About</Link>
                <Link to="/login">Login</Link>
            </nav>

            <hr />

            <Outlet />
        </div>

    )
}
