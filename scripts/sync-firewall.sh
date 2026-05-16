#!/usr/bin/env bash
# /opt/lntv/sync-firewall.sh
# Sincroniza public.firewall_rules -> ufw.
# - Importa regras existentes do ufw pro banco (na primeira execução).
# - Aplica/remove regras marcadas com "lntv-fw <uuid>".
# - Marca applied_at no banco após aplicar.

set -euo pipefail

PSQL=(docker exec -i supabase-db psql -U postgres -d postgres -tAq)
LOG_PREFIX="[$(date -Iseconds)] firewall sync:"

# ------- 1. IMPORT: regras do ufw que ainda não estão no banco -------
# Só importa regras que NÃO tenham o comment "lntv-fw" (essas já são nossas).
import_existing() {
  local count=0
  local line action target port proto direction note
  # ufw status numbered output. Parse linhas tipo:
  # [ 2] 80/tcp                     ALLOW IN    Anywhere                   # HTTP
  # [ 3] Anywhere                   DENY IN     203.0.113.99
  # [ 4] 5022/tcp                   ALLOW IN    24.152.8.0/22              # SSH restrito LN
  while IFS= read -r line; do
    # remove o prefixo [ N ]
    line="$(echo "$line" | sed -E 's/^\[[[:space:]]*[0-9]+\][[:space:]]*//')"

    # pula se não tiver ALLOW/DENY
    echo "$line" | grep -qE '\b(ALLOW|DENY|REJECT|LIMIT)\b' || continue
    # pula regras nossas (já marcadas)
    echo "$line" | grep -q "lntv-fw" && continue

    # captura comment (note) depois do #
    note="$(echo "$line" | sed -nE 's/.*#[[:space:]]*(.+)$/\1/p')"
    # remove comment do resto
    line_no_comment="$(echo "$line" | sed -E 's/#.*$//')"

    # campo 1 = to (porta/serviço ou Anywhere)
    # campo 2 = ACTION
    # campo 3 = DIR (IN/OUT)
    # campo 4+ = from
    local f_to f_action f_dir f_from
    f_to="$(echo "$line_no_comment"  | awk '{print $1}')"
    f_action="$(echo "$line_no_comment" | awk '{print $2}')"
    f_dir="$(echo "$line_no_comment" | awk '{print $3}')"
    f_from="$(echo "$line_no_comment" | awk '{for(i=4;i<=NF;i++) printf "%s ", $i; print ""}' | xargs || true)"

    # ignora IPv6 duplicado: o ufw mostra "(v6)" como sufixo
    echo "$f_to $f_from" | grep -q '(v6)' && continue

    case "$f_action" in
      ALLOW) action="allow" ;;
      DENY|REJECT) action="deny" ;;
      *) continue ;;
    esac
    direction="$(echo "$f_dir" | tr 'A-Z' 'a-z')"
    [ -z "$direction" ] && direction="in"

    # porta/proto
    port=""
    proto=""
    if echo "$f_to" | grep -qE '^[0-9]+(/[a-z]+)?$'; then
      port="$(echo "$f_to" | cut -d/ -f1)"
      proto="$(echo "$f_to" | cut -sd/ -f2)"
    fi

    # target = from (a não ser que seja Anywhere)
    target=""
    if [ -n "$f_from" ] && [ "$f_from" != "Anywhere" ] && [ "$f_from" != "Anywhere (v6)" ]; then
      target="$f_from"
    fi

    # se não tem target nem port, ignora (regra default)
    [ -z "$target" ] && [ -z "$port" ] && continue

    # escape SQL
    local sql_target sql_port sql_proto sql_note
    sql_target=$([ -z "$target" ] && echo "NULL" || echo "'$(echo "$target" | sed "s/'/''/g")'")
    sql_port=$([ -z "$port" ]   && echo "NULL" || echo "'$port'")
    sql_proto=$([ -z "$proto" ] && echo "NULL" || echo "'$proto'")
    sql_note=$([ -z "$note" ]   && echo "NULL" || echo "'$(echo "$note" | sed "s/'/''/g")'")

    "${PSQL[@]}" <<SQL || true
INSERT INTO public.firewall_rules (action, target, port, proto, direction, note, is_active, source, applied_at)
VALUES ('$action', $sql_target, $sql_port, $sql_proto, '$direction', $sql_note, true, 'imported', now())
ON CONFLICT DO NOTHING;
SQL
    count=$((count + 1))
  done < <(ufw status numbered | sed -E 's/\x1b\[[0-9;]*m//g')

  echo "$LOG_PREFIX importadas $count regras pré-existentes (se novas)"
}

# Roda import apenas se ainda não houver nenhuma regra com source='imported' no banco
already_imported="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public.firewall_rules WHERE source='imported';" 2>/dev/null || echo 0)"
if [ "${already_imported:-0}" = "0" ]; then
  import_existing
fi

# ------- 2. APPLY: aplica/remove regras marcadas no ufw -------

# 2a) Remove do ufw todas as regras com comentário "lntv-fw" que não existam mais ativas no banco
active_ids="$("${PSQL[@]}" -c "SELECT id FROM public.firewall_rules WHERE is_active=true;" || true)"

# parse ufw, encontra IDs com "lntv-fw" e remove os que não estão em active_ids
mapfile -t ufw_lines < <(ufw status numbered | grep "lntv-fw" || true)
# remove de baixo pra cima (índices mudam)
for ((i=${#ufw_lines[@]}-1; i>=0; i--)); do
  line="${ufw_lines[$i]}"
  num=$(echo "$line" | sed -E 's/^\[[[:space:]]*([0-9]+)\].*/\1/')
  uuid=$(echo "$line" | sed -nE 's/.*lntv-fw[[:space:]]+([0-9a-f-]+).*/\1/p')
  if ! echo "$active_ids" | grep -q "$uuid"; then
    yes | ufw delete "$num" >/dev/null 2>&1 || true
  fi
done

# 2b) Aplica regras que ainda não foram aplicadas (não aparecem no ufw com lntv-fw <id>)
rows="$("${PSQL[@]}" -c "SELECT id||'|'||action||'|'||COALESCE(target,'')||'|'||COALESCE(port,'')||'|'||COALESCE(proto,'')||'|'||direction FROM public.firewall_rules WHERE is_active=true;" || true)"

applied=0
ufw_status="$(ufw status numbered | sed -E 's/\x1b\[[0-9;]*m//g')"
while IFS='|' read -r id act tgt port proto dir; do
  [ -z "$id" ] && continue
  # já está no ufw?
  if echo "$ufw_status" | grep -q "lntv-fw $id"; then
    continue
  fi

  cmd="ufw insert 1 $act"
  [ -n "$dir" ] && cmd="$cmd ${dir}"
  [ -n "$proto" ] && cmd="$cmd proto $proto"
  if [ -n "$tgt" ]; then
    cmd="$cmd from $tgt"
  else
    cmd="$cmd from any"
  fi
  if [ -n "$port" ]; then
    cmd="$cmd to any port $port"
  fi
  cmd="$cmd comment 'lntv-fw $id'"

  if eval "$cmd" >/dev/null 2>&1; then
    "${PSQL[@]}" -c "UPDATE public.firewall_rules SET applied_at=now() WHERE id='$id';" >/dev/null || true
    applied=$((applied + 1))
  else
    echo "$LOG_PREFIX FALHOU: $cmd"
  fi
done <<< "$rows"

echo "$LOG_PREFIX $applied novas regras aplicadas"
