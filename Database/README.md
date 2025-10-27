# Database

Este diretório centraliza recursos relacionados ao banco de dados.

- Schema principal definido em `supabase/migrations/001_init.sql`.
- Índices e RLS já incluídos para segurança.
- Para futuras migrações, crie novos arquivos em `supabase/migrations/` com numeração sequencial.

## Diagramas / Modelo
Sugestão de entidades:
- organizations ↔ organization_members ↔ profiles
- profiles ↔ experiences / education / profile_skills ↔ skills
- jobs ↔ job_skills ↔ skills
- searches ↔ search_results ↔ (profiles ou jobs)
- reports (armazenamento de PDFs/XLSX)
- scrape_sources / scrape_queue / ingested_profiles / ingested_jobs

## Como evoluir o schema
- Adicione colunas/tabelas novas via migrations adicionais.
- Não edite a migração inicial em produção; crie uma nova.