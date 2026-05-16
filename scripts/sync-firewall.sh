#!/bin/bash
# sync-firewall.sh — aplica regras de public.firewall_rules via ufw
# Instalar em /opt/lntv/sync-firewall.sh e agendar no cron a cada minuto:
#   * * * * * /opt/lntv/sync-firewall.sh >> /var/log/lntv-firewall.log 2>&1
#
# Requisitos: ufw, docker (com container supabase-db rodando)

set -euo pipefail

MARK="# lntv-fw"   # marcador de regras gerenciadas

# Busca regras ativas do banco. Formato: action|target|id
RULES=$(docker exec -i supabase-db psql -U postgres -d postgres -At -F'|' <<'SQL'
SELECT action, target, id::text
FROM public.firewall_rules
WHERE is_active = true
ORDER BY action DESC, created_at ASC;
SQL
)

# 1) Remove regras antigas marcadas (ordem decrescente para não invalidar índices)
mapfile -t OLD < <(ufw status numbered | awk -F'[][]' "/$MARK/ {print \$2}" | sort -rn)
for n in "${OLD[@]}"; do
  yes | ufw delete "$n" >/dev/null || true
done

# 2) Aplica regras atuais
declare -a APPLIED_IDS=()
while IFS='|' read -r action target id; do
  [ -z "$action" ] && continue
  case "$action" in
    deny)  ufw insert 1 deny  from "$target" comment "$MARK $id" >/dev/null && APPLIED_IDS+=("$id") ;;
    allow) ufw insert 1 allow from "$target" comment "$MARK $id" >/dev/null && APPLIED_IDS+=("$id") ;;
  esac
done <<< "$RULES"

# 3) Marca applied_at no banco para as regras aplicadas
if [ "${#APPLIED_IDS[@]}" -gt 0 ]; then
  IDS_SQL=$(printf "'%s'," "${APPLIED_IDS[@]}")
  IDS_SQL="${IDS_SQL%,}"
  docker exec -i supabase-db psql -U postgres -d postgres -c \
    "UPDATE public.firewall_rules SET applied_at = now() WHERE id IN ($IDS_SQL);" >/dev/null
fi

ufw reload >/dev/null
echo "[$(date -Is)] firewall sync: ${#APPLIED_IDS[@]} regras aplicadas"
