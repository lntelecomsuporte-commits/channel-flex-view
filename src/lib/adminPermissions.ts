export const MASTER_ADMIN_EMAIL = "lucasiappe@yahoo.com.br";

export type PermissionGroup = { group: string; items: { key: string; label: string }[] };

export const PERMISSION_GROUPS: PermissionGroup[] = [
  { group: "Canais", items: [
    { key: "channels.view", label: "Ver aba Canais" },
    { key: "channels.edit", label: "Criar e editar canais" },
    { key: "channels.config_editor", label: "Usar Config Editor" },
    { key: "channels.delete", label: "Remover canais" },
    { key: "channels.reload_all", label: "Recarregar canais em todos os apps online" },
    { key: "channels.close_all", label: "Fechar todos os apps online" },
  ] },
  { group: "Categorias", items: [
    { key: "categories.manage", label: "Ver e gerenciar categorias" },
  ] },
  { group: "Usuários", items: [
    { key: "users.view", label: "Ver aba Usuários" },
    { key: "users.create", label: "Criar usuários" },
    { key: "users.edit", label: "Editar usuários" },
    { key: "users.block", label: "Bloquear / desbloquear usuários" },
    { key: "users.signout", label: "Deslogar usuários (logout remoto)" },
    { key: "users.reload_channels", label: "Recarregar canais do cliente (remoto)" },
    { key: "users.force_close", label: "Fechar app do cliente (remoto)" },
    { key: "users.delete", label: "Excluir usuários" },
    { key: "users.devices", label: "Gerenciar dispositivos" },
    { key: "users.playlist", label: "Gerar lista M3U / link curto" },
    { key: "users.set_admin", label: "Tornar / remover administrador" },
    { key: "admins.manage", label: "Gerenciar permissões de administradores" },
  ] },
  { group: "Outros", items: [
    { key: "hubsoft.manage", label: "Integração Hubsoft" },
    { key: "monitoring.view", label: "Monitoramento" },
    { key: "firewall.manage", label: "Firewall" },
    { key: "database.export", label: "Exportar banco (dump SQL)" },
  ] },
];

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));

/** Admin sem permissões personalizadas: tudo, exceto remover canais e gerenciar admins. */
export const LEGACY_ADMIN_PERMISSIONS = ALL_PERMISSIONS.filter(
  (p) => p !== "channels.delete" && p !== "admins.manage",
);

export const isMasterEmail = (email?: string | null) =>
  (email ?? "").trim().toLowerCase() === MASTER_ADMIN_EMAIL;

export function resolvePermissions(opts: {
  email?: string | null;
  isAdmin: boolean;
  custom: string[] | null;
}): Set<string> {
  if (isMasterEmail(opts.email)) return new Set(ALL_PERMISSIONS);
  if (!opts.isAdmin) return new Set();
  return new Set(opts.custom ?? LEGACY_ADMIN_PERMISSIONS);
}
