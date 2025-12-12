# Demo de Sistema Distribuído com Supabase

Este projeto demonstra uma arquitetura distribuída simples usando Docker, Nginx e duas instâncias do Supabase.

## Estrutura

- **backend1**: Node.js/Express conectado ao Supabase 1 (Primário). Roda na porta 3001.
- **backend2**: Node.js/Express conectado ao Supabase 2 (Secundário). Roda na porta 3002.
- **loadbalancer**: Nginx que distribui as requisições entre backend1 e backend2. Roda na porta 8081.

## Como Rodar

1. Certifique-se de ter o Docker e Docker Compose instalados.
2. Navegue até a pasta `distributed-system-demo`.
3. Execute o comando:

```bash
docker-compose up --build
```

4. Acesse `http://localhost:8081` no navegador.
   - Atualize a página várias vezes. Você verá que a resposta alterna entre "Backend 1" e "Backend 2" (Load Balancing).

## Testando Failover

1. Com o sistema rodando, pare um dos containers (ex: backend1):
```bash
docker stop distributed-system-demo-backend1-1
```
(O nome do container pode variar, use `docker ps` para verificar).

2. Continue acessando `http://localhost:8081`. O Nginx deve redirecionar automaticamente para o backend2.

## Detalhes das Instâncias

- **Supabase 1**: https://rnininxlmxdmcjooqwkc.supabase.co
- **Supabase 2**: https://yvniowvaxuupfwgknzvy.supabase.co
