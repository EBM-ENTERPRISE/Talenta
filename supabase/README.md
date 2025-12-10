# Supabase / Banco de Dados

Este diretório contém as migrações e instruções para o banco (Postgres) no Supabase.

## Como aplicar a migração

Você pode aplicar a migração de duas maneiras:

### 1) Console do Supabase
- Abra o projeto no Supabase.
- Vá em `SQL` → `New query`.
- Copie o conteúdo de `migrations/001_init.sql` e execute.

### 2) CLI do Supabase (local dev)
- Instale a CLI: `npm i -g supabase`
- Inicialize: `supabase init`
- Inicie serviços locais: `supabase start`
- Execute a migração:
  ```bash
  supabase db reset --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres" --use-mig-dir supabase/migrations
  ```

> Observação: ajuste `--db-url` conforme sua configuração local. Em ambiente cloud, aplique via console.

## Conteúdo
- `migrations/001_init.sql`: criação de tabelas (organizações, perfis, vagas, buscas, resultados), índices e políticas de RLS.

## Segurança
- As policies de RLS garantem que usuários só vejam dados do próprio usuário ou da organização de que fazem parte.
- Não commite chaves sensíveis no repositório. Use `.env` e variáveis de ambiente do deploy.