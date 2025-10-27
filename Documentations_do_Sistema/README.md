# Documentations_do_Sistema

Este diretório concentra documentação funcional e técnica da Talenta.

## Conteúdo sugerido
- Visão geral do produto e objetivos.
- Fluxo de busca (CSP): parsing → sourcing → scoring → reporting.
- Regras de scraping: conformidade legal, dados públicos, limites.
- Estrutura de diretórios do projeto.
- Decisões de arquitetura (ADR).

## Estrutura do Projeto (proposta)
- `front-end/` (Vite/React TS) → atualmente o app está na raiz. Migrar futuramente se desejar isolar módulos.
- `supabase/` → migrações e instruções do banco (Postgres).
- `Database/` → docs de schema e diagramas.
- `Documentations_do_Sistema/` → esta documentação.

## Próximos passos
- Adicionar diagramas (Mermaid ou Draw.io) do modelo de dados.
- Documentar endpoints (se criar backend adicional) e o fluxo de geração de relatórios.