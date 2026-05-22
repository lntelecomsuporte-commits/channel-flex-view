import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import legacy from "@vitejs/plugin-legacy";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Build legacy chunks (Android 5.x WebView, Chrome 49) somente quando
// explicitamente solicitado — normalmente para gerar o APK legacy.
// Sem isso, o build web normal não paga o custo do segundo passe + terser
// minificando um bundle de ~2MB (que era o que estava levando ~5min).
//
// Para gerar com legacy: `BUILD_LEGACY=1 npm run build`
const enableLegacy = process.env.BUILD_LEGACY === "1";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    enableLegacy &&
      legacy({
        targets: ["Android >= 5", "Chrome >= 49"],
        renderLegacyChunks: true,
        modernPolyfills: true,
      }),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  build: {
    target: "es2017",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
