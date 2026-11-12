import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendAppCommand } from "@/lib/appCommands";

const backend = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  errorToast: vi.fn(),
  successToast: vi.fn(),
}));

vi.mock("@/lib/supabaseLocal", () => ({
  supabase: { auth: { getUser: backend.getUser }, from: backend.from },
}));
vi.mock("@/integrations/supabase/client", () => {
  throw new Error("Remote commands must not use the cloud client");
});
vi.mock("sonner", () => ({
  toast: { error: backend.errorToast, success: backend.successToast },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  backend.getUser.mockResolvedValue({ data: { user: { id: "local-admin" } }, error: null });
  backend.from.mockReturnValue({ insert: backend.insert });
  backend.insert.mockResolvedValue({ error: null });
});

describe("remote commands use the panel session", () => {
  it("sends a client's close command with the authenticated local owner", async () => {
    await sendAppCommand("force_close", "lucas-client", "Lucas Iappe");
    expect(backend.getUser).toHaveBeenCalledOnce();
    expect(backend.from).toHaveBeenCalledWith("app_commands");
    expect(backend.insert).toHaveBeenCalledWith({
      command: "force_close", target_user_id: "lucas-client", created_by: "local-admin",
    });
    expect(backend.successToast).toHaveBeenCalledOnce();
  });

  it("sends global reload commands with a null target and the local owner", async () => {
    await sendAppCommand("reload_channels", null);
    expect(backend.insert).toHaveBeenCalledWith({
      command: "reload_channels", target_user_id: null, created_by: "local-admin",
    });
  });

  it("does not insert a command without an authenticated user", async () => {
    backend.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await sendAppCommand("force_close", "lucas-client");
    expect(backend.from).not.toHaveBeenCalled();
    expect(backend.errorToast).toHaveBeenCalledOnce();
  });

  it("does not insert when authentication validation fails", async () => {
    backend.getUser.mockResolvedValue({ data: { user: { id: "local-admin" } }, error: new Error("Expired") });
    await sendAppCommand("force_close", "lucas-client");
    expect(backend.from).not.toHaveBeenCalled();
  });

  it("does not send a command when confirmation is cancelled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await sendAppCommand("force_close", "lucas-client");
    expect(backend.getUser).not.toHaveBeenCalled();
    expect(backend.insert).not.toHaveBeenCalled();
  });

  it("reports a rejected insert without reporting success", async () => {
    backend.insert.mockResolvedValue({ error: { message: "permission denied" } });
    await sendAppCommand("force_close", "lucas-client");
    expect(backend.errorToast).toHaveBeenCalledOnce();
    expect(backend.successToast).not.toHaveBeenCalled();
  });

  it("allows an already confirmed bulk action to reload apps without a second prompt", async () => {
    const confirmation = vi.spyOn(window, "confirm");
    const sent = await sendAppCommand("reload_channels", null, undefined, { confirm: false });
    expect(sent).toBe(true);
    expect(confirmation).not.toHaveBeenCalled();
    expect(backend.insert).toHaveBeenCalledOnce();
  });
});
