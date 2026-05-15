import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseLocal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Trash2, ShieldOff, ShieldCheck, Pencil, LogOut, Download, ListVideo, Copy, RefreshCw } from "lucide-react";
const PLAYLIST_HOST = "https://tv2.lntelecom.net";
import { useCategories } from "@/hooks/useChannels";
import { UserStatusBadge } from "./UserStatusBadge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type AccessStats = {
  user_id: string;
  last_login_at: string | null;
  total_logins: number;
  logins_last_30d: number;
};

type TrialAccessRow = {
  user_id: string;
  trial_expires_at: string;
};

type SortMode = "recent" | "last_login_desc" | "last_login_asc" | "email_asc" | "name_asc" | "logins_30d_desc";
type ReportFilter = "all" | "never" | "active30d" | "trial" | null;

type Profile = {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  is_blocked: boolean;
  is_active: boolean;
  hubsoft_client_id: string | null;
  created_at: string;
  playlist_token: string | null;
  playlist_password: string | null;
};

function useProfiles() {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Profile[];
    },
  });
}

function useTrialAccess() {
  return useQuery({
    queryKey: ["user_trial_access"],
    queryFn: async () => {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("user_category_access")
        .select("user_id,trial_expires_at")
        .eq("is_trial", true)
        .eq("is_active", true)
        .gt("trial_expires_at", now);
      if (error) throw error;
      // earliest expiration per user
      const map = new Map<string, string>();
      ((data || []) as TrialAccessRow[]).forEach((row) => {
        const cur = map.get(row.user_id);
        if (!cur || new Date(row.trial_expires_at) < new Date(cur)) {
          map.set(row.user_id, row.trial_expires_at);
        }
      });
      return map;
    },
    refetchInterval: 60000,
  });
}

function formatTrialRemaining(iso: string): { label: string; expired: boolean } {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { label: "expirado", expired: true };
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days >= 1) return { label: `${days}d ${hours}h restantes`, expired: false };
  const mins = Math.floor((ms % 3600000) / 60000);
  return { label: `${hours}h ${mins}m restantes`, expired: false };
}

function useAccessStats() {
  return useQuery({
    queryKey: ["user_access_stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_access_stats")
        .select("user_id,last_login_at,total_logins,logins_last_30d");
      if (error) throw error;
      return (data || []) as AccessStats[];
    },
    refetchInterval: 60000,
  });
}

const UserManagement = () => {
  const { data: profiles, isLoading } = useProfiles();
  const { data: accessStats } = useAccessStats();
  const { data: trialMap } = useTrialAccess();
  const { data: categories } = useCategories();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ email: "", password: "", display_name: "" });
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [editForm, setEditForm] = useState({ password: "", display_name: "", adult_pin: "" });
  const [editCategories, setEditCategories] = useState<string[]>([]);
  const [editIntegrationAccess, setEditIntegrationAccess] = useState<Array<{
    hubsoft_config_id: string;
    hubsoft_config_name: string;
    normal_categories: string[];
    trial_categories: string[];
    trial_expires_at: string | null;
  }>>([]);
  const [editIntegrationCategoryIds, setEditIntegrationCategoryIds] = useState<string[]>([]);
  const [editIsAdmin, setEditIsAdmin] = useState(false);
  const [editWasAdmin, setEditWasAdmin] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeReport, setActiveReport] = useState<ReportFilter>(null);
  const [playlistUser, setPlaylistUser] = useState<Profile | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const buildPlaylistUrls = (p: Profile) => {
    const token = p.playlist_token ?? "";
    const u = encodeURIComponent(p.username ?? "");
    const pwd = encodeURIComponent(p.playlist_password ?? "");
    return {
      tokenUrl: `${PLAYLIST_HOST}/functions/v1/playlist?token=${token}&type=m3u`,
      hlsUrl: `${PLAYLIST_HOST}/functions/v1/playlist?u=${u}&p=${pwd}&type=hls`,
    };
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiado`);
    } catch {
      toast.error("Falha ao copiar");
    }
  };

  const regeneratePlaylistCreds = async () => {
    if (!playlistUser || regenerating) return;
    setRegenerating(true);
    try {
      const newPwd = Math.random().toString(36).slice(2, 14);
      const { data, error } = await supabase
        .from("profiles")
        .update({
          playlist_token: crypto.randomUUID(),
          playlist_password: newPwd,
        })
        .eq("id", playlistUser.id)
        .select("playlist_token, playlist_password")
        .single();
      if (error) throw error;
      setPlaylistUser({
        ...playlistUser,
        playlist_token: data.playlist_token,
        playlist_password: data.playlist_password,
      });
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      toast.success("Credenciais regeneradas — links anteriores invalidados");
    } catch (e) {
      toast.error("Erro ao regenerar: " + (e as Error).message);
    } finally {
      setRegenerating(false);
    }
  };

  const statsByUser = new Map<string, AccessStats>();
  (accessStats || []).forEach((s) => statsByUser.set(s.user_id, s));
  const allProfiles = profiles || [];
  const neverAccessed = allProfiles.filter(
    (p) => (statsByUser.get(p.user_id)?.total_logins || 0) === 0
  );
  const active30dProfiles = allProfiles.filter(
    (p) => (statsByUser.get(p.user_id)?.logins_last_30d || 0) > 0
  );
  const trialProfiles = allProfiles.filter((p) => trialMap?.has(p.user_id));
  const reportLabels: Record<Exclude<ReportFilter, null>, string> = {
    all: "Total de usuários",
    never: "Nunca acessaram",
    active30d: "Ativos (30d)",
    trial: "Em degustação",
  };

  const fmtDate = (iso: string | null) => {
    if (!iso) return "Nunca";
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  };

  const sortedProfiles = (() => {
    if (!profiles) return [];
    const term = searchTerm.trim().toLowerCase();
    const list = allProfiles.filter((p) => {
      if (activeReport === "never" && (statsByUser.get(p.user_id)?.total_logins || 0) !== 0) return false;
      if (activeReport === "active30d" && (statsByUser.get(p.user_id)?.logins_last_30d || 0) <= 0) return false;
      if (activeReport === "trial" && !trialMap?.has(p.user_id)) return false;
      if (!term) return true;
      return (
        (p.username || "").toLowerCase().includes(term) ||
        (p.display_name || "").toLowerCase().includes(term)
      );
    });
    const ts = (p: Profile) => {
      const t = statsByUser.get(p.user_id)?.last_login_at;
      return t ? new Date(t).getTime() : 0;
    };
    const cmp: Record<SortMode, (a: Profile, b: Profile) => number> = {
      recent: (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      last_login_desc: (a, b) => ts(b) - ts(a),
      last_login_asc: (a, b) => {
        const ta = ts(a), tb = ts(b);
        if (ta === 0 && tb === 0) return 0;
        if (ta === 0) return 1;
        if (tb === 0) return -1;
        return ta - tb;
      },
      email_asc: (a, b) => (a.username || "").localeCompare(b.username || ""),
      name_asc: (a, b) => (a.display_name || a.username || "").localeCompare(b.display_name || b.username || ""),
      logins_30d_desc: (a, b) =>
        (statsByUser.get(b.user_id)?.logins_last_30d || 0) -
        (statsByUser.get(a.user_id)?.logins_last_30d || 0),
    };
    return [...list].sort(cmp[sortMode]);
  })();

  const downloadCsv = (filename: string, rows: string[][]) => {
    const csv = rows
      .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportNeverAccessed = () => {
    const rows = [["Email", "Nome", "Criado em"]];
    neverAccessed.forEach((p) =>
      rows.push([p.username || "", p.display_name || "", fmtDate(p.created_at)])
    );
    downloadCsv(`usuarios-nunca-acessaram-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast.success(`${neverAccessed.length} usuários exportados`);
  };

  const exportAccess30d = () => {
    const rows = [["Email", "Nome", "Acessos 30d", "Total acessos", "Último acesso"]];
    allProfiles
      .map((p) => ({ p, s: statsByUser.get(p.user_id) }))
      .sort((a, b) => (b.s?.logins_last_30d || 0) - (a.s?.logins_last_30d || 0))
      .forEach(({ p, s }) =>
        rows.push([
          p.username || "",
          p.display_name || "",
          String(s?.logins_last_30d || 0),
          String(s?.total_logins || 0),
          fmtDate(s?.last_login_at || null),
        ])
      );
    downloadCsv(`relatorio-acessos-30d-${new Date().toISOString().slice(0, 10)}.csv`, rows);
    toast.success("Relatório exportado");
  };

  // Load user categories when editing
  useEffect(() => {
    if (!editingUser) {
      setEditCategories([]);
      setEditIntegrationAccess([]);
      setEditIntegrationCategoryIds([]);
      return;
    }
    (async () => {
      // Manual access only (no hubsoft_config_id) — these are editable
      const { data: manual } = await supabase
        .from("user_category_access")
        .select("category_id")
        .eq("user_id", editingUser.user_id)
        .eq("is_active", true)
        .eq("is_trial", false)
        .is("hubsoft_config_id", null);
      setEditCategories(manual?.map((d: any) => d.category_id) || []);

      // Integration-managed access (read-only display, includes trial info)
      const { data: integ } = await supabase
        .from("user_category_access")
        .select("category_id, trial_expires_at, is_trial, hubsoft_config_id")
        .eq("user_id", editingUser.user_id)
        .eq("is_active", true)
        .not("hubsoft_config_id", "is", null);

      const catIds = Array.from(new Set((integ || []).map((r: any) => r.category_id)));
      const cfgIds = Array.from(new Set((integ || []).map((r: any) => r.hubsoft_config_id).filter(Boolean)));
      const [cfgsRes, cfgCatsRes] = await Promise.all([
        cfgIds.length
          ? supabase.from("hubsoft_config").select("id,name").in("id", cfgIds)
          : Promise.resolve({ data: [] as any[] }),
        cfgIds.length
          ? supabase.from("hubsoft_config_categories").select("hubsoft_config_id,category_id").in("hubsoft_config_id", cfgIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      const configuredCatIds = (cfgCatsRes.data || []).map((c: any) => c.category_id);
      const allCatIds = Array.from(new Set([...catIds, ...configuredCatIds]));
      const catsRes = allCatIds.length
        ? await supabase.from("categories").select("id,name").in("id", allCatIds)
        : { data: [] as any[] };
      const catMap = new Map((catsRes.data || []).map((c: any) => [c.id, c.name]));
      const cfgMap = new Map((cfgsRes.data || []).map((c: any) => [c.id, c.name]));

      const byConfig = new Map<string, {
        hubsoft_config_id: string;
        hubsoft_config_name: string;
        normal_categories: string[];
        trial_categories: string[];
        trial_expires_at: string | null;
      }>();
      const ensureConfig = (configId: string) => {
        const existing = byConfig.get(configId);
        if (existing) return existing;
        const created = {
          hubsoft_config_id: configId,
          hubsoft_config_name: cfgMap.get(configId) || "Integração",
          normal_categories: [],
          trial_categories: [],
          trial_expires_at: null,
        };
        byConfig.set(configId, created);
        return created;
      };

      (cfgCatsRes.data || []).forEach((row: any) => {
        const group = ensureConfig(row.hubsoft_config_id);
        const name = catMap.get(row.category_id) || "(categoria)";
        if (!group.normal_categories.includes(name)) group.normal_categories.push(name);
      });

      (integ || []).forEach((row: any) => {
        const group = ensureConfig(row.hubsoft_config_id);
        const name = catMap.get(row.category_id) || "(categoria)";
        if (row.is_trial) {
          if (!group.trial_categories.includes(name)) group.trial_categories.push(name);
          if (row.trial_expires_at && (!group.trial_expires_at || new Date(row.trial_expires_at) < new Date(group.trial_expires_at))) {
            group.trial_expires_at = row.trial_expires_at;
          }
        } else if (!group.normal_categories.includes(name)) {
          group.normal_categories.push(name);
        }
      });

      setEditIntegrationAccess(Array.from(byConfig.values()));
      setEditIntegrationCategoryIds(Array.from(new Set([...catIds, ...configuredCatIds])));
    })();
  }, [editingUser]);

  const toggleCategory = (id: string, list: string[], setList: (v: string[]) => void) => {
    setList(list.includes(id) ? list.filter((c) => c !== id) : [...list, id]);
  };

  const saveCategoryAccess = async (userId: string, categoryIds: string[]) => {
    // Remove existing manual access (no hubsoft_config_id)
    await supabase
      .from("user_category_access")
      .delete()
      .eq("user_id", userId)
      .is("hubsoft_config_id", null);

    if (categoryIds.length > 0) {
      const rows = categoryIds.map((category_id) => ({
        user_id: userId,
        category_id,
        is_active: true,
      }));
      await supabase.from("user_category_access").insert(rows);
    }
  };

  const handleCreate = async () => {
    if (saving) return;
    if (!form.email || !form.password) {
      toast.error("Preencha email e senha");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("manage-users", {
      body: { action: "create", email: form.email, password: form.password, display_name: form.display_name || form.email },
    });
    setSaving(false);
    if (error || data?.error) {
      toast.error("Erro ao criar usuário: " + (data?.error || error?.message));
    } else {
      // Save category access for the new user
      if (data?.user_id && selectedCategories.length > 0) {
        await saveCategoryAccess(data.user_id, selectedCategories);
      }
      toast.success("Usuário criado!");
      setForm({ email: "", password: "", display_name: "" });
      setSelectedCategories([]);
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    }
  };

  const handleEdit = async (profile: Profile) => {
    setEditingUser(profile);
    const { data } = await supabase
      .from("profiles")
      .select("adult_pin")
      .eq("user_id", profile.user_id)
      .maybeSingle();
    setEditForm({ password: "", display_name: profile.display_name || "", adult_pin: data?.adult_pin || "" });
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("id")
      .eq("user_id", profile.user_id)
      .eq("role", "admin")
      .maybeSingle();
    const isAdmin = !!roleRow;
    setEditIsAdmin(isAdmin);
    setEditWasAdmin(isAdmin);
  };

  const handleUpdate = async () => {
    if (!editingUser) return;
    setUpdating(true);

    // Só chama o edge function se senha mudou OU display_name foi alterado de fato
    const displayNameChanged =
      editForm.display_name.trim() !== (editingUser.display_name || "").trim();
    const passwordChanged = editForm.password.length > 0;

    if (passwordChanged || displayNameChanged) {
      const body: Record<string, string> = { action: "update", user_id: editingUser.user_id };
      if (passwordChanged) body.password = editForm.password;
      if (displayNameChanged) body.display_name = editForm.display_name;
      const { data, error } = await supabase.functions.invoke("manage-users", { body });
      if (error || data?.error) {
        toast.error("Erro ao atualizar: " + (data?.error || error?.message));
        setUpdating(false);
        return;
      }
    }

    // Update adult_pin if provided
    if (editForm.adult_pin) {
      if (!/^\d{4,8}$/.test(editForm.adult_pin)) {
        toast.error("PIN parental deve ter 4 a 8 dígitos numéricos");
        setUpdating(false);
        return;
      }
      const { error: pinErr } = await supabase
        .from("profiles")
        .update({ adult_pin: editForm.adult_pin })
        .eq("user_id", editingUser.user_id);
      if (pinErr) {
        toast.error("Erro ao atualizar PIN: " + pinErr.message);
        setUpdating(false);
        return;
      }
    }

    // Always save category access
    await saveCategoryAccess(editingUser.user_id, editCategories);

    // Update admin role if changed
    if (editIsAdmin !== editWasAdmin) {
      const { data: rData, error: rErr } = await supabase.functions.invoke("manage-users", {
        body: { action: "set_admin", user_id: editingUser.user_id, is_admin: editIsAdmin },
      });
      if (rErr || rData?.error) {
        toast.error("Erro ao atualizar admin: " + (rData?.error || rErr?.message));
        setUpdating(false);
        return;
      }
    }

    setUpdating(false);
    toast.success("Usuário atualizado!");
    setEditingUser(null);
    queryClient.invalidateQueries({ queryKey: ["profiles"] });
  };

  const handleToggleBlock = async (profileId: string, currentBlocked: boolean) => {
    // Ao bloquear, também força logout remoto imediato
    const updates: { is_blocked: boolean; force_signout_at?: string } = { is_blocked: !currentBlocked };
    if (!currentBlocked) updates.force_signout_at = new Date().toISOString();
    const { error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", profileId);
    if (error) {
      toast.error("Erro: " + error.message);
      return;
    }
    toast.success(currentBlocked ? "Usuário desbloqueado" : "Usuário bloqueado e deslogado");
    queryClient.invalidateQueries({ queryKey: ["profiles"] });
  };

  const handleDelete = async (profileId: string, userId: string) => {
    if (deletingUserId) return;
    setDeletingUserId(userId);
    // Força signout antes de deletar — garante que sessão ativa seja encerrada
    await supabase
      .from("profiles")
      .update({ force_signout_at: new Date().toISOString() })
      .eq("id", profileId);
    const { data, error } = await supabase.functions.invoke("manage-users", {
      body: { action: "delete", user_id: userId },
    });
    setDeletingUserId(null);
    if (error || data?.error) {
      toast.error("Erro: " + (data?.error || error?.message));
    } else {
      toast.success("Usuário excluído");
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    }
  };

  const handleForceSignout = async (profileId: string, displayName: string | null) => {
    const { error } = await supabase
      .from("profiles")
      .update({ force_signout_at: new Date().toISOString() })
      .eq("id", profileId);
    if (error) {
      toast.error("Erro ao deslogar: " + error.message);
      return;
    }
    toast.success(`${displayName || "Usuário"} será deslogado em até 30s`);
    queryClient.invalidateQueries({ queryKey: ["profiles"] });
  };

  const toggleReport = (filter: Exclude<ReportFilter, null>) => {
    setActiveReport((current) => (current === filter ? null : filter));
    setSearchTerm("");
  };

  const ReportCard = ({
    filter,
    label,
    value,
    valueClass = "",
  }: {
    filter: Exclude<ReportFilter, null>;
    label: string;
    value: number;
    valueClass?: string;
  }) => (
    <button
      type="button"
      onClick={() => toggleReport(filter)}
      className={`p-3 rounded-lg bg-secondary text-left transition border border-transparent hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeReport === filter ? "border-primary ring-1 ring-primary" : ""}`}
      title={`Ver ${label.toLowerCase()}`}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${valueClass}`}>{value}</p>
    </button>
  );

  const CategoryCheckboxes = ({ selected, onToggle, lockedIds = [] }: { selected: string[]; onToggle: (id: string) => void; lockedIds?: string[] }) => (
    <div className="space-y-2">
      <Label>Categorias de Acesso</Label>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-40 overflow-y-auto border rounded-md p-2">
        {categories?.length ? categories.map((cat) => {
          const locked = lockedIds.includes(cat.id);
          const checked = locked || selected.includes(cat.id);
          return (
            <label key={cat.id} className={`flex items-center gap-2 text-sm ${locked ? "cursor-not-allowed opacity-80" : "cursor-pointer"}`} title={locked ? "Liberada pela integração Hubsoft" : undefined}>
              <Checkbox
                checked={checked}
                disabled={locked}
                onCheckedChange={() => !locked && onToggle(cat.id)}
              />
              <span>{cat.name}</span>
              {locked && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary ml-auto">integração</span>}
            </label>
          );
        }) : (
          <p className="text-xs text-muted-foreground col-span-full">Nenhuma categoria cadastrada</p>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Novo Usuário</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="usuario@email.com" />
            </div>
            <div className="space-y-2">
              <Label>Senha <span className="text-destructive">*</span></Label>
              <Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="Senha" />
            </div>
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={form.display_name} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} placeholder="Nome de exibição" />
            </div>
          </div>
          <CategoryCheckboxes
            selected={selectedCategories}
            onToggle={(id) => toggleCategory(id, selectedCategories, setSelectedCategories)}
          />
          <Button onClick={handleCreate} disabled={saving}>
            <Plus className="h-4 w-4 mr-1" /> {saving ? "Criando..." : "Criar Usuário"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Relatórios de Acesso</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <ReportCard filter="all" label="Total de usuários" value={allProfiles.length} />
            <ReportCard filter="never" label="Nunca acessaram" value={neverAccessed.length} valueClass="text-destructive" />
            <ReportCard filter="active30d" label="Ativos (30d)" value={active30dProfiles.length} valueClass="text-primary" />
            <ReportCard filter="trial" label="Em degustação" value={trialProfiles.length} valueClass="text-primary" />
            <div className="p-3 rounded-lg bg-secondary">
              <p className="text-xs text-muted-foreground">Acessos nos últimos 30d</p>
              <p className="text-2xl font-bold">
                {(accessStats || []).reduce((acc, s) => acc + (s.logins_last_30d || 0), 0)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={exportNeverAccessed} disabled={!neverAccessed.length}>
              <Download className="h-4 w-4 mr-1" /> Exportar nunca acessaram ({neverAccessed.length})
            </Button>
            <Button variant="outline" size="sm" onClick={exportAccess30d}>
              <Download className="h-4 w-4 mr-1" /> Exportar acessos 30 dias
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Usuários Cadastrados{activeReport ? ` · ${reportLabels[activeReport]}` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-2 mb-4">
            <Input
              placeholder="Buscar por nome ou email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="md:max-w-xs"
            />
            <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
              <SelectTrigger className="md:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Mais recentes (cadastro)</SelectItem>
                <SelectItem value="last_login_desc">Último online (mais recente)</SelectItem>
                <SelectItem value="last_login_asc">Último online (mais antigo)</SelectItem>
                <SelectItem value="email_asc">E-mail (A → Z)</SelectItem>
                <SelectItem value="name_asc">Nome (A → Z)</SelectItem>
                <SelectItem value="logins_30d_desc">Mais acessos (30d)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {isLoading ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : !sortedProfiles.length ? (
            <p className="text-muted-foreground">Nenhum usuário encontrado</p>
          ) : (
            <div className="space-y-2">
              {sortedProfiles.map((p) => {
                const s = statsByUser.get(p.user_id);
                return (
                <div key={p.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 rounded-lg bg-secondary gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">{p.display_name || p.username}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.username}</p>
                    <p className="text-xs text-muted-foreground">
                      Último online: {fmtDate(s?.last_login_at || null)}
                      {" · "}
                      {s?.logins_last_30d || 0} acessos (30d)
                      {" · "}
                      total {s?.total_logins || 0}
                    </p>
                    {p.hubsoft_client_id && (
                      <p className="text-xs text-muted-foreground">Hubsoft ID: {p.hubsoft_client_id}</p>
                    )}
                  </div>
                  <div className="flex items-center flex-wrap gap-2 shrink-0">
                    <UserStatusBadge userId={p.user_id} />
                    {trialMap?.get(p.user_id) && (() => {
                      const t = formatTrialRemaining(trialMap.get(p.user_id)!);
                      return (
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${t.expired ? "bg-destructive/20 text-destructive" : "bg-amber-500/20 text-amber-600 dark:text-amber-400"}`}
                          title={`Degustação até ${fmtDate(trialMap.get(p.user_id)!)}`}
                        >
                          🎁 Degustação · {t.label}
                        </span>
                      );
                    })()}
                    <span className={`text-xs px-2 py-0.5 rounded ${p.is_blocked ? "bg-destructive/20 text-destructive" : p.is_active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {p.is_blocked ? "Bloqueado" : p.is_active ? "Ativo" : "Inativo"}
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(p as Profile)} title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setPlaylistUser(p as Profile)} title="Gerar playlist M3U/HLS">
                      <ListVideo className="h-4 w-4 text-primary" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleForceSignout(p.id, p.display_name)} title="Deslogar usuário (forçar logout remoto)">
                      <LogOut className="h-4 w-4 text-amber-500" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleToggleBlock(p.id, p.is_blocked)} title={p.is_blocked ? "Desbloquear" : "Bloquear"}>
                      {p.is_blocked ? <ShieldCheck className="h-4 w-4 text-primary" /> : <ShieldOff className="h-4 w-4 text-destructive" />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(p.id, p.user_id)} disabled={deletingUserId === p.user_id}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Usuário</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{editingUser?.username}</p>
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={editForm.display_name} onChange={(e) => setEditForm((f) => ({ ...f, display_name: e.target.value }))} placeholder="Nome de exibição" />
            </div>
            <div className="space-y-2">
              <Label>Nova Senha</Label>
              <Input type="password" value={editForm.password} onChange={(e) => setEditForm((f) => ({ ...f, password: e.target.value }))} placeholder="Deixe vazio para manter a atual" />
            </div>
            <div className="space-y-2">
              <Label>PIN Parental (Conteúdo Adulto / Censurado)</Label>
              <Input
                type="text"
                inputMode="numeric"
                maxLength={8}
                value={editForm.adult_pin}
                onChange={(e) => setEditForm((f) => ({ ...f, adult_pin: e.target.value.replace(/\D/g, "") }))}
                placeholder="4 a 8 dígitos (padrão: 1234)"
              />
              <p className="text-xs text-muted-foreground">Senha pedida ao abrir canais marcados como adulto.</p>
            </div>
            <div className="space-y-2">
              <Label>Categorias de Acesso (manuais)</Label>
              <p className="text-xs text-muted-foreground">
                Categorias marcadas aqui são adicionadas manualmente. Não afetam o acesso vindo de integrações Hubsoft (mostrado abaixo).
              </p>
              <CategoryCheckboxes
                selected={editCategories}
                onToggle={(id) => toggleCategory(id, editCategories, setEditCategories)}
              />
            </div>

            {editIntegrationAccess.length > 0 && (
              <div className="space-y-2">
                <Label>Acesso vindo de integrações Hubsoft</Label>
                <div className="space-y-3 border rounded-md p-3 bg-secondary/40">
                  {editIntegrationAccess.map((group) => {
                    const t = group.trial_expires_at ? formatTrialRemaining(group.trial_expires_at) : null;
                    return (
                      <div key={group.hubsoft_config_id} className="space-y-2 text-sm">
                        <div className="font-medium">{group.hubsoft_config_name}</div>
                        {group.normal_categories.length > 0 && (
                          <div>
                            <span className="text-xs px-2 py-0.5 rounded bg-primary/20 text-primary">
                              Acesso fixo da integração
                            </span>
                            <div className="text-xs text-muted-foreground mt-1">{group.normal_categories.join(", ")}</div>
                          </div>
                        )}
                        {group.trial_categories.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-xs px-2 py-0.5 rounded ${t?.expired ? "bg-destructive/20 text-destructive" : "bg-secondary text-secondary-foreground"}`}>
                                🎁 Categorias em degustação{t ? ` · ${t.label}` : ""}
                              </span>
                              {group.trial_expires_at && (
                                <span className="text-xs text-muted-foreground">expira {fmtDate(group.trial_expires_at)}</span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">{group.trial_categories.join(", ")}</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Esses acessos são gerenciados pelo webhook da integração. Para alterar, use o painel de Integração Hubsoft ou aguarde o evento do ERP.
                </p>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm cursor-pointer p-3 rounded-md border border-border bg-secondary/50">
              <Checkbox checked={editIsAdmin} onCheckedChange={(v) => setEditIsAdmin(!!v)} />
              <span className="font-medium">Administrador do painel</span>
              <span className="text-xs text-muted-foreground ml-auto">Acesso total ao /admin</span>
            </label>
            <Button onClick={handleUpdate} disabled={updating} className="w-full">
              {updating ? "Salvando..." : "Salvar Alterações"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!playlistUser} onOpenChange={(open) => !open && setPlaylistUser(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Playlist M3U / HLS</DialogTitle>
          </DialogHeader>
          {playlistUser && (() => {
            const { tokenUrl, hlsUrl } = buildPlaylistUrls(playlistUser);
            return (
              <div className="space-y-5">
                <div className="text-sm text-muted-foreground">
                  Cliente: <span className="text-foreground font-medium">{playlistUser.display_name || playlistUser.username}</span>
                  <br />
                  E-mail: <span className="font-mono">{playlistUser.username}</span>
                </div>

                <div className="space-y-2">
                  <Label>Link M3U (token)</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={tokenUrl} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                    <Button variant="outline" size="icon" onClick={() => copyText(tokenUrl, "Link M3U")}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">URL única, sem usuário/senha. Funciona em qualquer player M3U.</p>
                </div>

                <div className="space-y-2">
                  <Label>Link HLS (usuário + senha)</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={hlsUrl} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                    <Button variant="outline" size="icon" onClick={() => copyText(hlsUrl, "Link HLS")}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <div>
                      <Label className="text-xs">Usuário</Label>
                      <div className="flex gap-1 mt-1">
                        <Input readOnly value={playlistUser.username ?? ""} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                        <Button variant="outline" size="icon" onClick={() => copyText(playlistUser.username ?? "", "Usuário")}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Senha</Label>
                      <div className="flex gap-1 mt-1">
                        <Input readOnly value={playlistUser.playlist_password ?? ""} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                        <Button variant="outline" size="icon" onClick={() => copyText(playlistUser.playlist_password ?? "", "Senha")}>
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">Pra apps que pedem campos separados (Tivimate, IPTV Smarters, etc).</p>
                </div>

                <div className="rounded-md border border-border bg-secondary/40 p-3 text-xs text-muted-foreground space-y-1">
                  <p>• Apenas canais que esse cliente tem acesso entram na lista (respeita degustação e categorias).</p>
                  <p>• Streams passam por <span className="font-mono">hls-proxy</span> com token assinado (validade 30 dias).</p>
                  <p>• Bloquear ou inativar o cliente derruba o acesso imediatamente.</p>
                </div>

                <Button variant="outline" onClick={regeneratePlaylistCreds} disabled={regenerating} className="w-full">
                  <RefreshCw className={`h-4 w-4 mr-2 ${regenerating ? "animate-spin" : ""}`} />
                  {regenerating ? "Regenerando..." : "Regenerar credenciais (invalida links antigos)"}
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserManagement;
