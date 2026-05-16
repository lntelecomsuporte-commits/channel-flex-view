#!/usr/bin/env bash
# /opt/lntv/sync-firewall.sh
# Sincroniza public.firewall_rules -> ufw.
# Suporta regras completas: origem (IP+porta), destino (IP+porta), proto, direção.

set -euo pipefail

PSQL=(docker exec -i supabase-db psql -U postgres -d postgres -tAq)
LOG_PREFIX="[$(date -Iseconds)] firewall sync:"

# ------- 1. IMPORT: regras do ufw que ainda não estão no banco -------
import_existing() {
  local count=0 line action target port proto direction note
  while IFS= read -r line; do
    line="$(echo "$line" | sed -E 's/^\[[[:space:]]*[0-9]+\][[:space:]]*//')"
    echo "$line" | grep -qE '\b(ALLOW|DENY|REJECT|LIMIT)\b' || continue
    echo "$line" | grep -q "lntv-fw" && continue

    note="$(echo "$line" | sed -nE 's/.*#[[:space:]]*(.+)$/\1/p')"
    line_no_comment="$(echo "$line" | sed -E 's/#.*$//')"

    local f_to f_action f_dir f_from
    f_to="$(echo "$line_no_comment"  | awk '{print $1}')"
    f_action="$(echo "$line_no_comment" | awk '{print $2}')"
    f_dir="$(echo "$line_no_comment" | awk '{print $3}')"
    f_from="$(echo "$line_no_comment" | awk '{for(i=4;i<=NF;i++) printf "%s ", $i; print ""}' | xargs || true)"

    echo "$f_to $f_from" | grep -q '(v6)' && continue

    case "$f_action" in
      ALLOW) action="allow" ;;
      DENY|REJECT) action="deny" ;;
      *) continue ;;
    esac
    direction="$(echo "$f_dir" | tr 'A-Z' 'a-z')"
    [ -z "$direction" ] && direction="in"

    port=""; proto=""
    if echo "$f_to" | grep -qE '^[0-9]+(/[a-z]+)?$'; then
      port="$(echo "$f_to" | cut -d/ -f1)"
      proto="$(echo "$f_to" | cut -sd/ -f2)"
    fi

    target=""
    if [ -n "$f_from" ] && [ "$f_from" != "Anywhere" ] && [ "$f_from" != "Anywhere (v6)" ]; then
      target="$f_from"
    fi

    [ -z "$target" ] && [ -z "$port" ] && continue

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

already_imported="$("${PSQL[@]}" -c "SELECT COUNT(*) FROM public.firewall_rules WHERE source='imported';" 2>/dev/null || echo 0)"
if [ "${already_imported:-0}" = "0" ]; then
  import_existing
fi

# ------- 2. APPLY: aplica/remove regras marcadas no ufw -------
active_ids="$("${PSQL[@]}" -c "SELECT id FROM public.firewall_rules WHERE is_active=true;" || true)"

# 2a. Remove do ufw regras gerenciadas (lntv-fw <id>) cujo id não está mais ativo
mapfile -t ufw_lines < <(ufw status numbered | grep "lntv-fw" || true)
for ((i=${#ufw_lines[@]}-1; i>=0; i--)); do
  line="${ufw_lines[$i]}"
  num=$(echo "$line" | sed -E 's/^\[[[:space:]]*([0-9]+)\].*/\1/')
  uuid=$(echo "$line" | sed -nE 's/.*lntv-fw[[:space:]]+([0-9a-f-]+).*/\1/p')
  if ! echo "$active_ids" | grep -q "$uuid"; then
    yes | ufw delete "$num" >/dev/null 2>&1 || true
  fi
done

# 2b. Aplica regras NOVAS do painel (source != 'imported').
# Regras 'imported' já existem no ufw, não devem ser re-inseridas.
# Se o admin pausar/excluir uma imported, ela some do banco/inativa mas permanece no ufw
# (intencional: não tocamos em regras pré-existentes automaticamente).
rows="$("${PSQL[@]}" -c "
  SELECT id||'|'||action||'|'||COALESCE(target,'')||'|'||COALESCE(src_port,'')
       ||'|'||COALESCE(dest_target,'')||'|'||COALESCE(port,'')
       ||'|'||COALESCE(proto,'')||'|'||direction
  FROM public.firewall_rules
  WHERE is_active=true AND COALESCE(source,'panel') <> 'imported';
" || true)"

applied=0
ufw_status="$(ufw status numbered | sed -E 's/\x1b\[[0-9;]*m//g')"
while IFS='|' read -r id act src_ip src_port dest_ip dest_port proto dir; do
  [ -z "$id" ] && continue
  if echo "$ufw_status" | grep -q "lntv-fw $id"; then
    continue
  fi

  # UFW exige proto quando há porta. Default = tcp se admin esqueceu.
  if [ -z "$proto" ] && { [ -n "$src_port" ] || [ -n "$dest_port" ]; }; then
    proto="tcp"
  fi

  cmd="ufw insert 1 $act"
  [ -n "$dir" ] && cmd="$cmd ${dir}"
  [ -n "$proto" ] && cmd="$cmd proto $proto"

  if [ -n "$src_ip" ]; then
    cmd="$cmd from $src_ip"
  else
    cmd="$cmd from any"
  fi
  [ -n "$src_port" ] && cmd="$cmd port $src_port"

  if [ -n "$dest_ip" ]; then
    cmd="$cmd to $dest_ip"
  else
    cmd="$cmd to any"
  fi
  [ -n "$dest_port" ] && cmd="$cmd port $dest_port"

  cmd="$cmd comment 'lntv-fw $id'"

  if eval "$cmd" >/dev/null 2>&1; then
    "${PSQL[@]}" -c "UPDATE public.firewall_rules SET applied_at=now(), last_error=NULL WHERE id='$id';" >/dev/null || true
    applied=$((applied + 1))
  else
    err_msg="$(eval "$cmd" 2>&1 || true)"
    err_esc="$(echo "$err_msg" | head -c 300 | sed "s/'/''/g")"
    "${PSQL[@]}" -c "UPDATE public.firewall_rules SET last_error='$err_esc' WHERE id='$id';" >/dev/null || true
    echo "$LOG_PREFIX FALHOU: $cmd  =>  $err_msg"
  fi
done <<< "$rows"

echo "$LOG_PREFIX $applied novas regras aplicadas"
