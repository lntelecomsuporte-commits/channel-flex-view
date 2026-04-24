#!/usr/bin/env bash
# ============================================================
# LN TV — Instalador Supabase self-hosted (Fase 4) v2
# Importa dump SQL exportado pela edge function 'export-database'
# ============================================================
set -euo pipefail

INSTALL_DIR="/opt/lntv"
BACKUP_DIR="${INSTALL_DIR}/backups"
SECRETS_FILE="${INSTALL_DIR}/SECRETS-IMPORTANTES.txt"

c_red()   { printf "\033[31m%s\033[0m\n" "$*"; }
c_green() { printf "\033[32m%s\033[0m\n" "$*"; }
c_yellow(){ printf "\033[33m%s\033[0m\n" "$*"; }
c_blue()  { printf "\033[34m%s\033[0m\n" "$*"; }
log()  { c_blue "[$(date +%H:%M:%S)] $*"; }
ok()   { c_green "✔ $*"; }
warn() { c_yellow "⚠ $*"; }
fail() { c_red "✖ $*"; exit 1; }

trap 'fail "Falhou na linha $LINENO. Veja o erro acima. Pra reinstalar do zero: sudo bash $0 reset"' ERR

# ---------- RESET ----------
if [[ "${1:-}" == "reset" ]]; then
  warn "Isso vai APAGAR todo o stack Supabase em ${INSTALL_DIR}"
  warn "Backups em ${BACKUP_DIR} e segredos em ${SECRETS_FILE} serão PRESERVADOS"
  read -r -p "Digite 'APAGAR' para confirmar: " CONF
  [[ "$CONF" == "APAGAR" ]] || fail "Cancelado."

  log "Parando e removendo containers + volumes..."
  if [[ -f "${INSTALL_DIR}/docker-compose.yml" ]]; then
    (cd "${INSTALL_DIR}" && docker compose down -v --remove-orphans 2>/dev/null || true)
  fi

  log "Removendo ${INSTALL_DIR} (preservando backups e segredos)..."
  if [[ -d "${BACKUP_DIR}" ]]; then mv "${BACKUP_DIR}" /tmp/lntv-backups-$$ ; fi
  if [[ -f "${SECRETS_FILE}" ]]; then mv "${SECRETS_FILE}" /tmp/lntv-secrets-$$ ; fi
  rm -rf "${INSTALL_DIR}"
  mkdir -p "${INSTALL_DIR}"
  if [[ -d /tmp/lntv-backups-$$ ]]; then mv /tmp/lntv-backups-$$ "${BACKUP_DIR}"; fi
  if [[ -f /tmp/lntv-secrets-$$ ]]; then mv /tmp/lntv-secrets-$$ "${SECRETS_FILE}"; fi
  ok "Reset completo. Rodando instalação limpa..."
fi

# ---------- 1/11 PRÉ-REQUISITOS ----------
log "1/11 Verificando pré-requisitos..."
[[ $EUID -eq 0 ]] || fail "Rode como root: sudo bash $0"
command -v docker >/dev/null   || fail "Docker não instalado. Instale: curl -fsSL https://get.docker.com | sh"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 não instalado."
command -v openssl >/dev/null  || fail "openssl não instalado: apt install -y openssl"
command -v git >/dev/null      || fail "git não instalado: apt install -y git"
ok "Pré-requisitos OK"

# ---------- 2/11 ESTRUTURA ----------
log "2/11 Criando estrutura em ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}" "${BACKUP_DIR}"
cd "${INSTALL_DIR}"
ok "Diretórios prontos"

# ---------- 3/11 CLONE SUPABASE ----------
log "3/11 Clonando supabase/docker..."
if [[ ! -d "${INSTALL_DIR}/supabase" ]]; then
  git clone --depth 1 https://github.com/supabase/supabase.git "${INSTALL_DIR}/.tmp-supabase"
  cp -r "${INSTALL_DIR}/.tmp-supabase/docker/." "${INSTALL_DIR}/"
  rm -rf "${INSTALL_DIR}/.tmp-supabase"
fi
ok "Stack Supabase baixado"

# ---------- 4/11 SEGREDOS ----------
log "4/11 Gerando segredos..."
if [[ ! -f "${SECRETS_FILE}" ]]; then
  POSTGRES_PASSWORD=$(openssl rand -hex 24)
  JWT_SECRET=$(openssl rand -hex 32)
  ANON_KEY="REGENERATE_AFTER_FIRST_BOOT"
  SERVICE_ROLE_KEY="REGENERATE_AFTER_FIRST_BOOT"
  DASHBOARD_PASSWORD=$(openssl rand -hex 12)
  cat > "${SECRETS_FILE}" <<EOF
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
JWT_SECRET=${JWT_SECRET}
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD}
EOF
  chmod 600 "${SECRETS_FILE}"
  ok "Segredos gerados em ${SECRETS_FILE}"
else
  ok "Segredos já existem (preservados)"
fi
# shellcheck disable=SC1090
source "${SECRETS_FILE}"

# ---------- 5/11 .env ----------
log "5/11 Gerando ${INSTALL_DIR}/.env..."
cp "${INSTALL_DIR}/.env.example" "${INSTALL_DIR}/.env"
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" "${INSTALL_DIR}/.env"
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" "${INSTALL_DIR}/.env"
sed -i "s|^DASHBOARD_USERNAME=.*|DASHBOARD_USERNAME=${DASHBOARD_USERNAME}|" "${INSTALL_DIR}/.env"
sed -i "s|^DASHBOARD_PASSWORD=.*|DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD}|" "${INSTALL_DIR}/.env"
ok ".env gerado"

# ---------- 6/11 KONG PRIVADO + REMOVE ANALYTICS ----------
log "6/11 Configurando Kong privado e removendo analytics..."
sed -i 's|"\${KONG_HTTP_PORT}:8000/tcp"|"127.0.0.1:${KONG_HTTP_PORT}:8000/tcp"|g'   "${INSTALL_DIR}/docker-compose.yml" || true
sed -i 's|"\${KONG_HTTPS_PORT}:8443/tcp"|"127.0.0.1:${KONG_HTTPS_PORT}:8443/tcp"|g' "${INSTALL_DIR}/docker-compose.yml" || true

# Remove o serviço analytics e suas dependências (não essencial e quebra em servidores menores)
python3 - <<'PY'
import re, sys
p = "/opt/lntv/docker-compose.yml"
with open(p) as f: s = f.read()
# Remove bloco analytics: ... até a próxima service no mesmo nível de indentação
s = re.sub(r'\n  analytics:\n(?:    .*\n)+', '\n', s)
# Remove referencias ao analytics em depends_on
s = re.sub(r'\n      analytics:\n        condition: service_healthy\n', '\n', s)
s = re.sub(r'\n      - analytics\n', '\n', s)
with open(p, "w") as f: f.write(s)
print("docker-compose.yml: serviço 'analytics' removido")
PY
ok "Kong em 127.0.0.1 + analytics desativado"

# ---------- 7/11 PULL ----------
log "7/11 Baixando imagens (pode demorar 2-5 min)..."
(cd "${INSTALL_DIR}" && docker compose pull)
ok "Imagens baixadas"

# ---------- 8/11 SUBIR STACK ----------
log "8/11 Subindo stack..."
(cd "${INSTALL_DIR}" && docker compose up -d)
log "Aguardando Postgres ficar saudável..."
for i in $(seq 1 60); do
  if docker exec supabase-db pg_isready -U postgres >/dev/null 2>&1; then ok "Postgres pronto"; break; fi
  sleep 2
  [[ $i -eq 60 ]] && fail "Postgres não respondeu em 120s"
done

# ---------- 9/11 IMPORTAR DUMP ----------
log "9/11 Importando dump SQL..."
echo
c_yellow "Você precisa do arquivo .sql exportado pelo painel admin do Lovable."
c_yellow "(Admin → botão 'Exportar BD' → arquivo lntv-dump-YYYY-MM-DD.sql)"
echo
read -r -p "Caminho completo do arquivo .sql (ex: /root/lntv-dump-2026-04-24.sql): " DUMP_PATH

if [[ ! -f "$DUMP_PATH" ]]; then
  warn "Arquivo não encontrado: $DUMP_PATH"
  warn "Pulando importação. Você pode importar depois com:"
  echo "    docker exec -i supabase-db psql -U postgres -d postgres < SEU-DUMP.sql"
else
  log "Importando $DUMP_PATH para o banco..."
  docker exec -i supabase-db psql -U postgres -d postgres < "$DUMP_PATH" \
    && ok "Dump importado com sucesso" \
    || warn "Importação teve avisos. Verifique a saída acima."
fi

# ---------- 10/11 BACKUP INICIAL ----------
log "10/11 Criando backup inicial..."
BKP="${BACKUP_DIR}/initial-$(date +%Y%m%d-%H%M%S).sql.gz"
docker exec supabase-db pg_dumpall -U postgres | gzip > "$BKP" || warn "Backup falhou (não crítico)"
[[ -f "$BKP" ]] && ok "Backup salvo em $BKP"

# ---------- 11/11 RESUMO ----------
log "11/11 Concluído!"
echo
c_green "================================================"
c_green "  LN TV self-hosted está rodando!"
c_green "================================================"
echo
echo "  Studio (admin Supabase):  http://127.0.0.1:8000"
echo "  Login Studio:             ${DASHBOARD_USERNAME} / ${DASHBOARD_PASSWORD}"
echo "  Postgres:                 localhost:5432 (user: postgres)"
echo "  Senha postgres:           ${POSTGRES_PASSWORD}"
echo
echo "  Segredos:                 ${SECRETS_FILE}"
echo "  Backup inicial:           ${BKP:-(não criado)}"
echo
c_yellow "PRÓXIMOS PASSOS:"
echo "  1. Configure proxy reverso (nginx/caddy) apontando p/ 127.0.0.1:8000"
echo "  2. Atualize VITE_SUPABASE_URL no app pra apontar pro novo domínio"
echo "  3. Regenere ANON_KEY e SERVICE_ROLE_KEY no Studio (Settings → API)"
echo "  4. Teste login com usuário existente (lucasiappe@yahoo.com.br)"
echo
ok "Fim."
