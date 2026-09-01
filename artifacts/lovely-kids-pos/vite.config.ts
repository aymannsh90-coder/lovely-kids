import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: "auto",

      // لدينا Manifest مستقل للـ POS العادي وManifest آخر للموبايل
      manifest: false,

      includeAssets: [
        "icon-192.png",
        "icon-512.png",
        "apple-touch-icon.png"
      ],

      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: "/index.html",
        globPatterns: [
          "**/*.{js,css,html,ico,png,svg,webp,woff,woff2,webmanifest}"
        ],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.lovelykids\.net\//,
            handler: "NetworkOnly",
            method: "GET"
          },
          {
            urlPattern: /^https:\/\/api\.lovelykids\.net\//,
            handler: "NetworkOnly",
            method: "POST"
          },
          {
            urlPattern: /^https:\/\/api\.lovelykids\.net\//,
            handler: "NetworkOnly",
            method: "PUT"
          },
          {
            urlPattern: /^https:\/\/api\.lovelykids\.net\//,
            handler: "NetworkOnly",
            method: "PATCH"
          },
          {
            urlPattern: /^https:\/\/api\.lovelykids\.net\//,
            handler: "NetworkOnly",
            method: "DELETE"
          }
        ]
      }
    })
  ],

  build: {
    outDir: "dist",
    emptyOutDir: true
  },

  server: {
    host: "0.0.0.0",
    allowedHosts: true
  },

  preview: {
    host: "0.0.0.0",
    allowedHosts: true
  }
});
