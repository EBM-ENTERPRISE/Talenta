# Plano para Sistema Distribuído Tolerante a Falhas (Backends e Frontends)

## Objetivo
- Tornar o sistema realmente distribuído e tolerante a falhas em backend e frontend.
- Garantir replicação de dados entre backends: toda escrita feita em um backend deve ser aplicada no outro.
- Assegurar continuidade de serviço: se um nó falhar, outro assume automaticamente sem intervenção manual.

## Estado Atual
- Balanceamento de carga via Nginx com failover básico em `distributed-system/nginx/nginx.conf`.
- Health check de backend existente em `distributed-system/backend/server.js:33` (`/health`).
- Sincronização passiva limitada dos dados de `searches` em `distributed-system/backend/server.js:243-261` e loop em `distributed-system/backend/server.js:277-329`.
- Frontends servidos via Nginx com upstream `frontend_cluster`, porém cada build aponta diretamente para um backend distinto (via `VITE_SUPABASE_URL`).

## Requisitos
- Failover transparente para `/api` usando Nginx entre `backend-1` e `backend-2`.
- Replicação ativa de todas as escritas: dual-write com idempotência e retry.
- Prevenção de loops de replicação e duplicidade de operações.
- Persistência de eventos quando o peer estiver indisponível (outbox com reprocessamento).
- Observabilidade mínima para validar saúde e sincronização.

## Design Proposto
- Nginx
  - Manter upstreams para `backend_cluster` e `frontend_cluster` e ativar políticas de failover agressivas.
  - Adicionar `max_fails` e `fail_timeout` nos `server` do upstream para retirar nós instáveis do pool.
  - Usar `proxy_next_upstream error timeout http_500 http_502 http_503 http_504` (já presente) e ajustar timeouts.
- Frontend
  - Unificar `VITE_SUPABASE_URL` para apontar para o Load Balancer: `http://localhost:9090/api`.
  - Com isso, a seleção do backend saudável passa a ser responsabilidade do Nginx.
- Backend (Active-Active)
  - Dual-write com Outbox Pattern:
    - Em cada operação de escrita (POST/PUT/PATCH/DELETE) relevante, registrar evento em `replication_outbox` (Supabase) com `operation_id`, `endpoint`, `payload`, `headers`, `created_at`.
    - Processador de outbox envia para `PEER_URL` com retries e backoff exponencial.
  - Idempotência e deduplicação:
    - Gerar `operation_id` único por request e propagar no header `X-Operation-Id`.
    - No peer, manter tabela `replication_operations` para ignorar operações já aplicadas (upsert com `onConflict: operation_id`).
  - Prevenção de loop:
    - Incluir `X-Replicated-From: backend-1|backend-2`; se presente, não repropagar.
  - Fallback de sincronização:
    - Manter o `runSyncLoop` existente como segurança para recuperar operações perdidas.
  - Circuit breaker e retry:
    - Implementar retries com backoff (p.ex., 3 tentativas, 250ms/500ms/1s) e timeouts curtos (`axios` com `timeout`).
- Persistência/Filas
  - Preferência por Redis como fila durável para outbox (alternativa: tabela Supabase `replication_outbox`).
  - Se Redis não for adicionado agora, use a tabela no Supabase e um job periódico no backend para drenar eventos.
- Observabilidade
  - Endpoint `/replication/status` com contagem de pendentes e últimos erros.
  - Logs estruturados em todas as tentativas de replicação.

## Alterações por Arquivo
- `distributed-system/nginx/nginx.conf`
  - Em `upstream backend_cluster`, alterar para:
    - `server backend-1:3000 max_fails=3 fail_timeout=10s;`
    - `server backend-2:3000 max_fails=3 fail_timeout=10s;`
  - Em `server { location /api/ { ... } }`:
    - Confirmar `proxy_next_upstream` e `proxy_connect_timeout 2s;`
    - Adicionar `proxy_read_timeout 5s; proxy_send_timeout 5s;` e `proxy_http_version 1.1;`.
- `distributed-system/docker-compose.yml`
  - Backends (`backend-1`, `backend-2`):
    - `restart: unless-stopped`
    - `healthcheck`: `curl -f http://localhost:3000/health || exit 1` com `interval: 10s`, `timeout: 3s`, `retries: 3`.
    - Garantir `PEER_URL` cruzado (já existente).
  - Frontends:
    - Unificar `build.args.VITE_SUPABASE_URL` para `http://localhost:9090/api` (mesmo para `frontend-1` e `frontend-2`).
    - `restart: unless-stopped` e healthcheck simples (Nginx respondendo `200` em `/`).
  - Opcional: adicionar serviço `redis` com porta interna e dependências dos backends.
- `distributed-system/backend/server.js`
  - Interceptar writes e registrar Outbox:
    - Middleware para POST/PUT/PATCH/DELETE nas rotas de função (ex.: `/functions/v1/save-search` e demais) antes de escrever.
    - Gerar `operation_id`, incluir em `X-Operation-Id` e salvar em `replication_outbox` (Supabase).
  - Replicador ativo:
    - Worker que consome `replication_outbox`, envia ao `PEER_URL` e marca como concluído.
    - Headers: `X-Operation-Id`, `X-Replicated-From`, `Content-Type`/auth.
  - Idempotência no peer:
    - Antes de aplicar, verificar `replication_operations` por `operation_id`; se existir, ignorar.
  - Manter `runSyncLoop` atual como fallback: `distributed-system/backend/server.js:277-329`.
- `supabase/migrations/*.sql`
  - Criar tabela `replication_outbox`:
    - `id UUID PK`, `operation_id TEXT UNIQUE`, `endpoint TEXT`, `method TEXT`, `payload JSONB`, `headers JSONB`, `created_at TIMESTAMPTZ`, `status TEXT`.
  - Criar tabela `replication_operations`:
    - `operation_id TEXT PK`, `applied_at TIMESTAMPTZ`, `source TEXT`.
  - Índices em `operation_id` e `created_at`.
- `Dockerfile.frontend`
  - Sem mudanças funcionais, apenas confirma args/env do build com `VITE_SUPABASE_URL=http://localhost:9090/api`.

## Fluxos
- Escrita
  - Cliente → Nginx `/api` → Backend A
  - Backend A aplica escrita, grava Outbox, tenta replicar para Backend B (com idempotência).
  - Se B indisponível, evento permanece na Outbox e será drenado quando B voltar.
- Leitura
  - Cliente → Nginx `/api` → Backend saudável (A ou B).
  - Dados lidos do Supabase; replicações garantem convergência.

## Plano de Testes
- Failover
  - Derrubar `backend-1` (`docker compose stop backend-1`).
  - Validar que `http://localhost:9090/api` continua respondendo via `backend-2`.
- Replicação
  - Criar uma `save-search` via `backend-1`.
  - Confirmar no `backend-2` que operação foi aplicada (consulta Supabase ou endpoint `/replication/status`).
  - Derrubar `backend-2`, gerar escritas em `backend-1`, subir `backend-2` e validar drenagem da Outbox.
- Frontend
  - Acessar `http://localhost:9090` e verificar páginas mesmo com um frontend parado.

## Passos de Implementação (Resumo)
1. Ajustar Nginx com `max_fails`/`fail_timeout` e timeouts.
2. Unificar `VITE_SUPABASE_URL` dos frontends para `http://localhost:9090/api`.
3. Adicionar healthchecks e `restart: unless-stopped` no Compose.
4. Implementar Outbox + replicador ativo nos backends com headers de idempotência.
5. Criar migrations de `replication_outbox` e `replication_operations` no Supabase.
6. (Opcional) Adicionar Redis como fila e migrar Outbox para Redis.
7. Escrever testes manuais/automáticos e validar cenários de falha.
