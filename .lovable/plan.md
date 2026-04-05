## Plano: App IPTV com Painel Web + Player

### 1. Ativar Lovable Cloud (backend)
- Database para canais, categorias
- Autenticação para o painel admin

### 2. Design System
- Tema escuro (ideal para TV)
- Cores e tokens otimizados para tela grande

### 3. Banco de Dados
- Tabela `channels` (nome, URL HLS do Flussonic, logo, número, categoria)
- Tabela `categories` (nome, ordem)
- RLS para admin gerenciar, público ler

### 4. Painel Web Admin (`/admin`)
- CRUD de canais (nome, URL Flussonic, logo, número, categoria)
- Organização por categorias
- Auth protegido

### 5. Player de TV (`/` - tela principal)
- Player HLS fullscreen
- Navegação: ↑↓ troca canal, → mostra info próximo canal, OK confirma
- OSD (On-Screen Display) com info do canal atual
- Transição suave entre canais

### 6. Capacitor Setup
- Configurar para build Android (TV + mobile)