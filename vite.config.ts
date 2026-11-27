import { defineConfig, type Plugin } from "vite";
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

// Mirror nginx's static admin entry in development; retain the requested router URL.
function adminHtmlEntry(): Plugin {
  return {
    name: "admin-html-entry",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [pathname, query] = (req.url ?? "").split("?");
        if (pathname === "/admin" || pathname === "/admin/" || pathname === "/admin/login" || pathname === "/admin/login/") {
          req.url = `/admin/index.html${query ? `?${query}` : ""}`;
        }
        next();
      });
    },
  };
}

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
    adminHtmlEntry(),
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
    rollupOptions: {
      input: {
        tv: path.resolve(__dirname, "index.html"),
        admin: path.resolve(__dirname, "admin/index.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
