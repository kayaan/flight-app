import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { useAuthStore } from "../features/auth/store/auth.store";
import { useAuthUser, useIsAuthenticated } from "../features/auth/store/auth.selector";
import { useOpenLoginModal } from "../store/ui.selectors";
import { LoginModal } from "../features/auth/ui/LoginModal";
import { Button } from "@mantine/core";
import { IconLock } from "@tabler/icons-react";



export const Route = createRootRoute({
    component: RootLayout,
})

function RootLayout() {

    const logout = useAuthStore((s) => s.logout)

    const isAuthenticated = useIsAuthenticated()
    const user = useAuthUser()

    const openLoginModal = useOpenLoginModal();

    return (
        <div>
            <nav style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 16px'
            }}>
                <div style={{ display: 'flex', gap: 12 }}>
                    <Button
                        variant="subtle"
                        component={Link}
                        to="/"
                    >
                        Home
                    </Button>
                    <Button
                        variant="subtle"
                        component={Link}
                        to="/personal"
                        leftSection={!isAuthenticated ? <IconLock size={14} /> : undefined}
                    >
                        Personal
                    </Button>
                    <Button
                        variant="subtle"
                        component={Link}
                        to="/flights"
                        leftSection={!isAuthenticated ? <IconLock size={14} /> : undefined}
                    >
                        Flights
                    </Button>
                    <Button
                        variant="subtle"
                        component={Link}
                        to="/about"
                    >
                        About
                    </Button>
                </div>

                <div>
                    {!isAuthenticated &&
                        <Button
                            onClick={() => openLoginModal('manual')}>Login</Button>
                    }
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
                            <Button onClick={logout}>Logout</Button>
                        </div>
                    )}

                </div>
            </nav>
            <hr />

            <LoginModal />
            <Outlet />
        </div>

    )
}
