import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [
    react(),
    tanstackRouter(),

    VitePWA({
      registerType: "prompt", // kontrolliertes Update (nicht “silent”)
      includeAssets: ["favicon.svg", "robots.txt"],

      manifest: {
        name: "FlyApp",
        short_name: "FlyApp",
        description: "IGC flights viewer (local-first)",
        start_url: "/flights",
        scope: "/",
        display: "standalone",
        background_color: "#0b0f19",
        theme_color: "#0b0f19",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },

      workbox: {
        // SPA fallback (wichtig bei Client-Routing)
        navigateFallback: "/index.html",

        // App-Shell offline cachen
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],

        // Optional: wenn du Tile-Server nutzt (OSM/Topo), kannst du das später ergänzen
        // runtimeCaching: [...]
      },
    }),
  ],
});
