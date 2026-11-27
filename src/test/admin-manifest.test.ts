import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getAppManifest } from "@/lib/appManifest";

describe("admin home-screen app isolation", () => {
  it("uses the admin manifest on both launch and login", () => {
    expect(getAppManifest("/admin")).toBe("/admin-manifest.json");
    expect(getAppManifest("/admin/login")).toBe("/admin-manifest.json");
  });

  it("keeps player and unrelated paths on their original manifest", () => {
    for (const path of ["/", "/login", "/privacidade", "/administrator"]) {
      expect(getAppManifest(path)).toBe("/manifest.json");
    }
  });

  it("launches independently into the admin, with unrestricted orientation", () => {
    const manifest = JSON.parse(readFileSync("public/admin-manifest.json", "utf8"));
    expect(manifest.id).toBe("/admin");
    expect(manifest.start_url).toBe("/admin");
    expect(manifest.scope).toBe("/admin");
    expect(manifest.orientation).toBe("any");
    expect(manifest.display).toBe("standalone");
  });

  it("preserves the installed TV app launch and orientation", () => {
    const manifest = JSON.parse(readFileSync("public/manifest.json", "utf8"));
    expect(manifest.start_url).toBe("/");
    expect(manifest.orientation).toBe("landscape");
  });

  it("declares real square PNGs in the advertised dimensions", () => {
    const manifest = JSON.parse(readFileSync("public/admin-manifest.json", "utf8"));
    for (const icon of manifest.icons) {
      const png = readFileSync(`public${icon.src}`);
      const dimensions = `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
      expect(dimensions).toBe(icon.sizes);
      expect(png.subarray(1, 4).toString()).toBe("PNG");
    }
  });
});