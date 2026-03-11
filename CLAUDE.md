# CLAUDE.md — Instruções do Projeto SercofiRH

> **Este arquivo é lido automaticamente pelo Claude Code (Antigravity) ao abrir o projeto.**

## Projeto

SercofiRH — SaaS multi-tenant para automação de processamento de cartões de ponto com OCR + IA.

## Documentação Obrigatória (leia antes de codificar)

1. `docs/SKILL.md` — Padrões de implementação e exemplos de código
2. `docs/RULES.md` — Regras absolutas que nunca podem ser violadas
3. `docs/SPECS.md` — Schema do banco, rotas da API, pipeline OCR
4. `docs/PRD.md` — Requisitos funcionais e não-funcionais

## Comandos Frequentes

```bash
pnpm install                                    # Instalar deps
docker-compose up -d                            # Infra local
pnpm --filter api run start:dev                 # Backend dev
pnpm --filter web run dev                       # Frontend dev
pnpm --filter api run prisma migrate dev        # Nova migration
pnpm --filter api run lint                      # Lint
pnpm --filter api run test                      # Testes
pnpm --filter api run prisma studio             # DB GUI
```

## Regras Críticas (resumo)

- **pnpm** (nunca npm/yarn)
- **TypeScript strict** (nunca `any`)
- **tenantId do JWT** (nunca do body/query)
- **Zod** para validação de DTOs
- **Soft delete** (nunca DELETE físico)
- **Logs JSON** (nunca console.log)
- **Testes** para toda rota nova
- **Conventional commits** (`feat:`, `fix:`, `refactor:`, etc.)

## Estrutura de Módulos NestJS

```
src/modules/
├── auth/              # Login, JWT, Argon2id
├── tenant/            # Gestão de tenants
├── empresa/           # Empresas-cliente
├── funcionario/       # Funcionários
├── upload/            # Upload de PDFs → Blob Storage → Fila
├── ocr-pipeline/      # Document Intelligence + OpenAI + Parser
├── revisao/           # Revisão humana lado a lado
├── export/            # CSV/XLSX
├── dashboard/         # Métricas e relatórios
├── audit/             # Auditoria de ações
└── health/            # Health checks
```

## Padrão de Resposta da API

```json
// Sucesso
{ "data": {}, "meta": { "page": 1, "limit": 20, "total": 100 }, "requestId": "uuid" }

// Erro
{ "statusCode": 400, "error": "Bad Request", "message": "...", "timestamp": "...", "path": "...", "requestId": "uuid" }
```

## Multi-Tenancy

- TODA tabela tem `tenantId`
- RLS habilitado no PostgreSQL
- `TenantGuard` seta `app.current_tenant` antes de cada transação
- SUPER_ADMIN bypassa RLS via role separada

## Pipeline OCR

```
Upload → BullMQ Queue → Worker:
  1. Azure Document Intelligence (Layout API)
  2. Card Parser (estruturar)
  3. Confidence Scorer (pontuar)
  4. AI Filter (OpenAI) — só se confiança < 0.80
  5. Salvar CartaoPonto + Batidas no banco
```
