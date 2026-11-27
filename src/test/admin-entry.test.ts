import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { needsAppEntryReload } from "@/lib/appManifest";
import { configureAdminNginx } from "../../scripts/configure-admin-nginx.mjs";

describe("static admin entry routing", () => {
  it("reloads the static HTML when navigating from TV into /admin or its login", () => {
    expect(needsAppEntryReload("/admin", "tv", "/")).toBe(true);
    expect(needsAppEntryReload("/admin/login", "tv", "/")).toBe(true);
  });

  it("keeps admin navigation local and reloads when returning to the TV", () => {
    expect(needsAppEntryReload("/admin/login", "admin", "/admin")).toBe(false);
    expect(needsAppEntryReload("/admin", "admin", "/admin/login")).toBe(false);
    expect(needsAppEntryReload("/", "admin", "/admin")).toBe(true);
    expect(needsAppEntryReload("/", "tv", "/login")).toBe(false);
  });

  it("does not create a reload loop when a host still serves the TV HTML for /admin", () => {
    expect(needsAppEntryReload("/admin", "tv", "/admin")).toBe(false);
    expect(needsAppEntryReload("/admin/login", "tv", "/admin")).toBe(false);
  });

  it("delivers the independent /admin launch manifest without JavaScript", () => {
    const html = new DOMParser().parseFromString(readFileSync("admin/index.html", "utf8"), "text/html");
    const path = html.querySelector('link[rel="manifest"]')?.getAttribute("href");
    expect(path).toBe("/admin-manifest.json");
    const manifest = JSON.parse(readFileSync(`public${path}`, "utf8"));
    expect(manifest.id).toBe("/admin");
    expect(manifest.start_url).toBe("/admin");
  });
});

const server = `server {
    listen 443 ssl;
    server_name tv2.lntelecom.net;
    root /var/www/lntv;
    location / { try_files $uri $uri/ /index.html; }
    location /logos/ { alias /opt/lntv-frontend/public/logos/; }
}`;

describe("self-hosted admin routing installation", () => {
  it("routes /admin and /admin/login to the static entry while preserving TV/logo routing", () => {
    const result = configureAdminNginx(server);
    expect(result.changed).toBe(true);
    expect(result.source).toContain("location = /admin {");
    expect(result.source).toContain("location ^~ /admin/ {");
    expect(result.source.match(/try_files \/admin\/index.html =404;/g)).toHaveLength(2);
    expect(result.source).toContain("location / { try_files $uri $uri/ /index.html; }");
    expect(result.source).toContain("location /logos/ { alias /opt/lntv-frontend/public/logos/; }");
  });

  it("does not alter other domains or HTTP redirect servers", () => {
    const other = server.replace("tv2.lntelecom.net", "outro.example.com");
    expect(configureAdminNginx(other)).toEqual({ source: other, found: false, changed: false });
    const redirect = "server { listen 80; server_name tv2.lntelecom.net; return 301 https://$host$request_uri; }";
    expect(configureAdminNginx(redirect).source).toBe(redirect);
  });

  it("is safe to rerun and refuses conflicting admin locations", () => {
    const installed = configureAdminNginx(server).source;
    expect(configureAdminNginx(installed)).toEqual({ source: installed, found: true, changed: false });
    expect(() => configureAdminNginx(server.replace("location / {", "location /admin {"))).toThrow(/Já existe/);
  });

  it("ignores braces inside comments and quoted strings", () => {
    const quoted = server.replace("root /var/www/lntv;", 'root /var/www/lntv;\n# }\nadd_header X-Test "}";');
    expect(configureAdminNginx(quoted).source).toContain("location = /admin {");
  });
});