import { describe, expect, it } from "vitest";
import { resolvePermissions, ALL_PERMISSIONS } from "@/lib/adminPermissions";

describe("permissões de administrador", () => {
  it("master lucasiappe@yahoo.com.br tem todas as permissões, mesmo com lista vazia", () => {
    const p = resolvePermissions({ email: "LucasIappe@yahoo.com.br", isAdmin: true, custom: [] });
    expect(p.size).toBe(ALL_PERMISSIONS.length);
  });
  it("admin sem personalização não remove canais nem gerencia admins", () => {
    const p = resolvePermissions({ email: "x@y.com", isAdmin: true, custom: null });
    expect(p.has("channels.delete")).toBe(false);
    expect(p.has("admins.manage")).toBe(false);
    expect(p.has("users.edit")).toBe(true);
  });
  it("admin personalizado só tem o que foi marcado", () => {
    const p = resolvePermissions({ email: "x@y.com", isAdmin: true, custom: ["monitoring.view"] });
    expect([...p]).toEqual(["monitoring.view"]);
  });
  it("não-admin não tem nada", () => {
    expect(resolvePermissions({ email: "x@y.com", isAdmin: false, custom: ["users.edit"] }).size).toBe(0);
  });
});
