import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: "auto",
      includeAssets: [
        "icon-192.png",
        "icon-512.png",
        "apple-touch-icon.png"
      ],
      manifest: {
        id: "/",
        name: "Lovely Kids POS",
        short_name: "Lovely Kids",
        description: "نظام المبيعات وإدارة متجر Lovely Kids",
        lang: "ar",
        dir: "rtl",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "landscape-primary",
        background_color: "#F0FAFE",
        theme_color: "#E91E8C",
        categories: ["business", "finance", "shopping"],
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png"
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff,woff2}"],
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
