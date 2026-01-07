import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { useAuthStore } from "../features/auth/store/auth.store";
import { useAuthUser, useIsAuthenticated } from "../features/auth/store/auth.selector";



export const Route = createRootRoute({
    component: RootLayout,
})

function RootLayout() {

    const { logout } = useAuthStore()

    const isAuthenticated = useIsAuthenticated()
    const user = useAuthUser()

    return (
        <div>
            <nav style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 16px'
            }}>
                <div style={{ display: 'flex', gap: 12 }}>
                    <Link to="/">Home</Link>
                    <Link to="/about">About</Link>
                </div>

                <div>
                    {!isAuthenticated && <Link to="/login">Login</Link>}
                    {isAuthenticated && user && (
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                cursor: "pointer"
                            }}
                        >
                            <span role='img' aria-label="user">
                                👤
                            </span>
                            <span>
                                {user.firstname} {user.lastname}
                            </span>
                            <button onClick={logout}>
                                Logout
                            </button>
                        </div>
                    )}

                </div>
            </nav>
            <hr />
            <Outlet />
        </div>

    )
}
