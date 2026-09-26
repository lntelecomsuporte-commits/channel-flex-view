#!/usr/bin/env bash
# ==============================================================================
# LN TV — Script de Restauração Automatizada / Migração de Servidor
# Uso: sudo bash restaurar-lntv.sh /caminho/para/backup_lntv_completo_DATA.tar.gz
#
# Restaura em uma máquina nova (Ubuntu 22.04+ / Debian 11+):
#   - Dependências: Docker, Docker Compose v2, Node.js 20, Nginx, cron, certbot
#   - /opt/lntv (stack Supabase, .env, segredos)
#   - /opt/lntv-frontend (código + scripts de sincronização)
#   - /opt/lntv-downloads (APKs + version.json)
#   - /var/www/lntv (build publicado, logos, EPG)
#   - /usr/local/bin (scripts de automação)
#   - Nginx + Let's Encrypt + crontab
#   - Banco PostgreSQL completo (pg_dumpall)
# ==============================================================================
set -euo pipefail

c_green="\033[32m"; c_yellow="\033[33m"; c_red="\033[31m"; c_blue="\033[34m"; c_reset="\033[0m"
log()  { echo -e "${c_blue}[$(date +%H:%M:%S)]${c_reset} $*"; }
ok()   { echo -e "${c_green}✔ $*${c_reset}"; }
warn() { echo -e "${c_yellow}⚠ $*${c_reset}"; }
fail() { echo -e "${c_red}✖ $*${c_reset}"; exit 1; }

[[ $EUID -eq 0 ]] || fail "Execute como root: sudo bash $0 <arquivo_backup.tar.gz>"

BACKUP_FILE="${1:-}"
[[ -n "${BACKUP_FILE}" ]] || fail "Informe o arquivo de backup. Ex: sudo bash $0 backup_lntv_completo_xxx.tar.gz"
[[ -f "${BACKUP_FILE}" ]] || fail "Arquivo não encontrado: ${BACKUP_FILE}"

WORKDIR="/tmp/lntv_restore_$$"
mkdir -p "${WORKDIR}"
trap 'rm -rf "${WORKDIR}"' EXIT

# ---------- 1/8 DESCOMPACTAR ----------
log "1/8 Descompactando pacote de backup..."
tar -xzf "${BACKUP_FILE}" -C "${WORKDIR}"
# O backup pode vir com uma pasta raiz: entra nela se for o caso
INNER=$(find "${WORKDIR}" -maxdepth 1 -mindepth 1 -type d | head -1)
if [[ -n "${INNER}" && ! -f "${WORKDIR}/opt_lntv.tar.gz" && -f "${INNER}/opt_lntv.tar.gz" ]]; then
  WORKDIR="${INNER}"
fi
ok "Pacote descompactado."

# ---------- 2/8 DEPENDÊNCIAS ----------
log "2/8 Instalando dependências do sistema operacional..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl wget git rsync openssl jq cron ca-certificates gnupg ufw nginx certbot python3-certbot-nginx

if ! command -v docker >/dev/null 2>&1; then
  log "Instalando Docker Engine..."
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 não disponível."

if ! command -v node >/dev/null 2>&1; then
  log "Instalando Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs
fi
ok "Dependências instaladas."

# ---------- 3/8 ARQUIVOS ----------
log "3/8 Restaurando diretórios e arquivos da aplicação..."
mkdir -p /opt /var/www/lntv /root/backups_lntv /usr/local/bin

untar_if() {  # $1 = arquivo dentro do backup, $2 = destino
  if [[ -f "${WORKDIR}/$1" ]]; then
    tar -xzf "${WORKDIR}/$1" -C "$2"
    ok "Restaurado: $1 → $2"
  else
    warn "Não encontrado no backup (ignorado): $1"
  fi
}

untar_if "opt_lntv.tar.gz"            /opt/
untar_if "opt_lntv-frontend.tar.gz"   /opt/
untar_if "opt_lntv-downloads.tar.gz"  /opt/
untar_if "var_www_lntv.tar.gz"        /var/www/
untar_if "usr_local_bin.tar.gz"       /usr/local/bin/
untar_if "nginx_sites.tar.gz"         /etc/nginx/
untar_if "letsencrypt.tar.gz"         /etc/
untar_if "opt_lntv-secrets.tar.gz"    /opt/

chmod +x /usr/local/bin/* 2>/dev/null || true
chmod 600 /opt/lntv/.env 2>/dev/null || true
chmod 600 /opt/lntv/SECRETS-IMPORTANTES.txt 2>/dev/null || true
ok "Arquivos posicionados."

# ---------- 4/8 CONTAINERS ----------
log "4/8 Iniciando stack Docker do Supabase..."
[[ -f /opt/lntv/docker-compose.yml ]] || fail "docker-compose.yml não encontrado em /opt/lntv"
cd /opt/lntv
docker compose up -d
ok "Containers inicializados."

# ---------- 5/8 AGUARDAR POSTGRES ----------
log "5/8 Aguardando o banco PostgreSQL ficar pronto..."
DB_CONTAINER="$(docker compose ps -q db 2>/dev/null || true)"
[[ -n "${DB_CONTAINER}" ]] || DB_CONTAINER="$(docker ps -qf 'name=supabase-db' | head -1)"
[[ -n "${DB_CONTAINER}" ]] || fail "Container do banco de dados não encontrado."

READY=0
for _ in $(seq 1 60); do
  if docker exec "${DB_CONTAINER}" pg_isready -U postgres >/dev/null 2>&1; then READY=1; break; fi
  sleep 2
done
[[ "${READY}" -eq 1 ]] || fail "PostgreSQL não respondeu a tempo. Veja: docker logs ${DB_CONTAINER}"
ok "PostgreSQL respondendo."

# ---------- 6/8 BANCO DE DADOS ----------
log "6/8 Restaurando banco de dados (tabelas, usuários, integrações)..."
DUMP=""
for cand in pg_dumpall.sql postgres_all.sql db_dump.sql database.sql; do
  [[ -f "${WORKDIR}/${cand}" ]] && DUMP="${WORKDIR}/${cand}" && break
done
if [[ -z "${DUMP}" ]]; then
  DUMP="$(find "${WORKDIR}" -maxdepth 2 -name '*.sql' | head -1 || true)"
fi

if [[ -n "${DUMP}" ]]; then
  log "Aplicando dump: $(basename "${DUMP}")"
  docker exec -i "${DB_CONTAINER}" psql -U postgres -v ON_ERROR_STOP=0 < "${DUMP}" > /tmp/lntv_restore_db.log 2>&1 || true
  ok "Banco restaurado (log em /tmp/lntv_restore_db.log)."
else
  CUSTOM="$(find "${WORKDIR}" -maxdepth 2 \( -name '*.dump' -o -name '*.custom' \) | head -1 || true)"
  if [[ -n "${CUSTOM}" ]]; then
    docker cp "${CUSTOM}" "${DB_CONTAINER}:/tmp/restore.dump"
    docker exec "${DB_CONTAINER}" pg_restore -U postgres -d postgres --clean --if-exists /tmp/restore.dump || true
    ok "Banco restaurado a partir do dump custom."
  else
    warn "Nenhum dump SQL encontrado no backup — banco ficou vazio!"
  fi
fi

log "Reiniciando serviços que dependem do banco..."
docker compose restart edge-runtime kong rest auth 2>/dev/null || docker compose restart 2>/dev/null || true
ok "Serviços do Supabase reiniciados."

# ---------- 7/8 CRON ----------
log "7/8 Restaurando rotinas agendadas (cron)..."
CRONFILE=""
for cand in crontab.txt crontab_root.txt cron_root.txt; do
  [[ -f "${WORKDIR}/${cand}" ]] && CRONFILE="${WORKDIR}/${cand}" && break
done
if [[ -n "${CRONFILE}" ]]; then
  crontab "${CRONFILE}"
  ok "Crontab restaurado ($(wc -l < "${CRONFILE}") linhas)."
else
  warn "Crontab não encontrado no backup — reconfigure manualmente (sync-epg, sync-logos, backup diário)."
fi

# ---------- 8/8 SERVIÇOS ----------
log "8/8 Ativando serviços no boot e recarregando Nginx..."
systemctl enable docker nginx cron >/dev/null 2>&1 || true
systemctl start docker nginx cron >/dev/null 2>&1 || true
if nginx -t >/dev/null 2>&1; then
  systemctl reload nginx
  ok "Nginx recarregado."
else
  warn "Configuração do Nginx com erro. Rode 'nginx -t' para ver os detalhes."
fi

echo ""
echo -e "${c_green}=========================================================${c_reset}"
echo -e "${c_green}    MIGRAÇÃO / RESTAURAÇÃO CONCLUÍDA COM SUCESSO!        ${c_reset}"
echo -e "${c_green}=========================================================${c_reset}"
echo "Próximos passos para virar a chave:"
echo ""
echo "1. Aponte o DNS de tv2.lntelecom.net para o IP desta máquina."
echo "2. Depois que o DNS propagar, renove o certificado SSL:"
echo "     certbot --nginx -d tv2.lntelecom.net"
echo "3. Confira o sistema:"
echo "     docker ps"
echo "     curl -I https://tv2.lntelecom.net/version.json"
echo "     Acesse https://tv2.lntelecom.net/admin"
echo "4. Se precisar reconstruir o site do zero:"
echo "     cd /opt/lntv-frontend && npm ci && npm run build \\"
echo "       && rsync -a --delete --exclude logos --exclude epg dist/ /var/www/lntv/"
echo ""
