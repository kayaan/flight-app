import { createRoot } from 'react-dom/client'
import './index.css'
import { registerSW } from "virtual:pwa-register";
import { routeTree } from './routeTree.gen'
import { createRouter, RouterProvider } from '@tanstack/react-router'

import '@mantine/core/styles.css'
import { MantineProvider } from '@mantine/core'
import { ModalsProvider } from '@mantine/modals'
import "leaflet/dist/leaflet.css";

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const updateSW = registerSW({
  onNeedRefresh() {
    // minimaler prompt – später können wir Mantine Modal nutzen
    const ok = confirm("New version available. Reload now?");
    if (ok) updateSW(true);
  },
  onOfflineReady() {
    console.log("App ready to work offline.");
  },
});

createRoot(document.getElementById('root')!).render(
  // <StrictMode>
  <MantineProvider>
    <ModalsProvider>
      <RouterProvider router={router} />
    </ModalsProvider>
  </MantineProvider>
  // </StrictMode>,
)
