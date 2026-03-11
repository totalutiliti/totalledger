# RULES — SercofiRH: Regras de Desenvolvimento

> **Audiência:** Claude Code (Antigravity) e desenvolvedores humanos.  
> **Objetivo:** Regras obrigatórias que devem ser seguidas em TODA implementação.

---

## 1. Regras de Arquitetura

### 1.1 Stack Obrigatória
- **Backend:** NestJS com TypeScript strict
- **Frontend:** Next.js 14+ com App Router e TypeScript strict
- **Banco:** PostgreSQL 16 com Prisma ORM
- **Package manager:** pnpm (NUNCA npm ou yarn)
- **Node.js:** v20+

### 1.2 Estrutura de Módulos NestJS
- Cada domínio é um Module NestJS separado: `auth`, `tenant`, `empresa`, `funcionario`, `upload`, `ocr-pipeline`, `revisao`, `export`, `dashboard`, `audit`, `health`
- Módulos NUNCA fazem import direto de services de outros módulos. Use exports do module ou eventos de domínio.
- Cada module tem sua pasta com: `module.ts`, `controller.ts`, `service.ts`, `dto/`
- NUNCA crie um "shared service" que faça tudo. Cada service tem uma responsabilidade.

### 1.3 Multi-Tenancy
- TODA tabela com dados de tenant DEVE ter coluna `tenantId`.
- `tenantId` SEMPRE vem do JWT decodificado, NUNCA do body/query/params da requisição.
- RLS habilitado em TODAS as tabelas com `tenantId`.
- O `TenantGuard` seta `app.current_tenant` no PostgreSQL antes de cada transação.
- SUPER_ADMIN usa role PostgreSQL separada que bypassa RLS.
- Testar isolamento: criar dados no tenant A e garantir que query do tenant B retorna vazio.

### 1.4 API Design
- Todas as rotas sob `/api/v1/`
- Formato de resposta padrão:
  ```json
  {
    "data": {},
    "meta": { "page": 1, "limit": 20, "total": 100 },
    "requestId": "uuid"
  }
  ```
- Formato de erro padrão:
  ```json
  {
    "statusCode": 400,
    "error": "Bad Request",
    "message": "Descrição útil",
    "timestamp": "ISO-8601",
    "path": "/api/v1/...",
    "requestId": "uuid"
  }
  ```
- Status codes corretos: 200 (OK), 201 (Created), 202 (Accepted para async), 400, 401, 403, 404, 409, 429, 500
- Paginação: `?page=1&limit=20` com `meta` no response
- Soft delete em todas as entidades (campo `deletedAt`)

---

## 2. Regras de Segurança

### 2.1 Autenticação
- JWT com expiração de 8h (access) e 7d (refresh)
- Argon2id + pepper para hash de senhas (NUNCA bcrypt)
- Pepper armazenado no Key Vault, nunca no código ou `.env`
- `mustChangePassword` obrigatório no primeiro login
- Rate limit em login: 5 tentativas por IP em 15 minutos

### 2.2 Autorização
- RBAC com 4 roles: `SUPER_ADMIN`, `ADMIN`, `SUPERVISOR`, `ANALISTA`
- Deny-by-default: toda rota protegida por `@Roles()` decorator
- SUPER_ADMIN é cross-tenant (acesso global)
- ADMIN gerencia apenas seu próprio tenant
- Validação de permissão SEMPRE no backend (frontend esconde, backend bloqueia)

### 2.3 Headers de Segurança
- Helmet habilitado no NestJS
- CORS: SOMENTE origens explícitas (frontend URL). NUNCA `*` em produção.
- HSTS com max-age 31536000
- CSP configurado para Next.js

### 2.4 Dados Sensíveis
- CPF: criptografado em campo (AES-256)
- Senhas: NUNCA em log, NUNCA em response
- PII: mascarado em logs de produção
- Uploads (PDFs): acesso apenas via URL com SAS token temporário

---

## 3. Regras de Código

### 3.1 TypeScript
- `strict: true` em todos os tsconfigs
- NUNCA usar `any`. Use `unknown` e faça type narrowing.
- Todos os DTOs validados com Zod (NUNCA class-validator sozinho)
- Interfaces para contratos entre módulos
- Enums no Prisma, constantes tipadas no código

### 3.2 Naming Conventions
- **Arquivos:** kebab-case (`ocr-pipeline.service.ts`)
- **Classes:** PascalCase (`OcrPipelineService`)
- **Variáveis/funções:** camelCase (`processarCartao`)
- **Constantes:** UPPER_SNAKE_CASE (`MAX_UPLOAD_SIZE`)
- **Banco (tabelas):** snake_case plural (`cartoes_ponto`)
- **Banco (colunas):** camelCase no Prisma, snake_case no SQL (Prisma mapeia)
- **Rotas API:** kebab-case (`/cartoes-ponto`)

### 3.3 Tratamento de Erros
- `GlobalExceptionFilter` captura TODAS as exceções
- NestJS exceptions tipadas: `NotFoundException`, `ForbiddenException`, `ConflictException`, etc.
- NUNCA expor stack trace ou detalhes internos para o cliente
- Log detalhado no servidor (com requestId), mensagem genérica para o cliente
- Custom exceptions para domínio: `TenantSuspendedException`, `OcrProcessingException`, etc.

### 3.4 Logs
- Logs em JSON estruturado (NUNCA `console.log` em produção)
- Campos obrigatórios: `timestamp`, `level`, `message`, `requestId`, `tenantId`, `userId`
- Níveis: `error` (sempre), `warn` (anomalias), `info` (ações de negócio), `debug` (dev only)
- PII NUNCA nos logs (mascarar CPF, email, nome)

### 3.5 Commits e PRs
- Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- Branch naming: `feat/RF-001-upload-pdf`, `fix/RF-013-batida-parsing`
- Todo PR deve ter: descrição, testes passando, lint passando

---

## 4. Regras de Banco de Dados

### 4.1 Migrations
- NUNCA editar uma migration existente
- Cada mudança = nova migration
- Migration destrutiva: usar expand/contract (ver guia-arquitetura.docx Fase 3.8)
- Testar migration em ambiente separado antes de aplicar em prod

### 4.2 Índices Obrigatórios
- `tenantId` em TODA tabela multi-tenant
- Colunas usadas em WHERE, ORDER BY, JOIN
- Composite index para queries frequentes
- Validar com EXPLAIN ANALYZE

### 4.3 Constraints
- Foreign keys em todas as relações
- NOT NULL em campos obrigatórios
- UNIQUE onde fizer sentido (email+tenantId, cnpj+tenantId)
- CHECK constraints para enums e ranges

### 4.4 Seeds
- Seed de desenvolvimento com dados realistas
- Seed de teste limpo e reproduzível
- NUNCA seed com dados de produção

---

## 5. Regras de Processamento OCR

### 5.1 Pipeline Assíncrono
- Upload NUNCA bloqueia: retorna 202 e coloca na fila BullMQ
- Worker separado processa o OCR
- DLQ para falhas após 3 tentativas
- Status tracking via polling ou WebSocket

### 5.2 Azure Document Intelligence
- Usar Layout API para extração de tabelas
- Fallback: se Layout falhar, tentar Read API
- Guardar raw response completo em `ocrRawData` (JSONB) para debug
- NUNCA descartar dados brutos do OCR

### 5.3 Azure OpenAI (Filtro IA)
- Chamar SOMENTE para campos com confiança < 0.80
- Modelo: GPT-4o-mini (custo otimizado)
- Timeout: 30 segundos por chamada
- Fallback: se IA falhar, manter valor do OCR e flag para revisão humana
- Logar TODA interação: input, output, tokens, latência, custo estimado

### 5.4 Confiança
- Score por campo individual (0.0 a 1.0)
- Score geral do cartão = média ponderada
- Threshold para revisão automática: < 0.80
- Campos manuscritos iniciam com -0.15 no score base

---

## 6. Regras de Testes

### 6.1 Obrigatórios Antes de Release
- Testes de integração para TODAS as rotas CRUD
- Teste de isolamento multi-tenant (tenant A não vê dados de B)
- Teste de RBAC (analista não acessa rota de admin)
- Teste de pipeline OCR com PDFs de exemplo
- Teste de validação de DTOs (campos ausentes, tipos errados)

### 6.2 Estrutura de Testes
- Diretório `test/integration/` para testes de API
- Diretório `test/unit/` para lógica de negócio (parser, scorer)
- Helper `test-app.helper.ts` para criar NestJS testing module
- Helper `auth.helper.ts` para gerar tokens de teste
- Helper `seed.helper.ts` para dados de teste reproduzíveis
- Setup: criar banco de teste → rodar migrations → seed
- Teardown: limpar dados entre testes

### 6.3 Cobertura Mínima
- Integração: todas as rotas críticas (auth, upload, revisão)
- Unitário: card-parser, confidence-scorer, hashing
- Meta: 0 lint errors, 0 warnings

---

## 7. Regras de Deploy

### 7.1 Ambientes
- `dev`: Docker Compose local + Azurite para Blob Storage
- `staging`: Azure Container Apps (min-replicas: 0)
- `prod`: Azure Container Apps (min-replicas: 1 em horário comercial)

### 7.2 Azure Container Apps
- Dockerfile multi-stage (build + runtime)
- Health check: `/api/v1/health` (liveness) e `/api/v1/health/ready` (readiness)
- Graceful shutdown implementado
- Env vars via Azure Key Vault references

### 7.3 IaC
- Toda infra definida em Bicep
- Tags obrigatórias: `Environment`, `Project`, `Owner`, `CentroDeCusto`
- Naming convention: `rg-sercofi-{env}`, `ca-sercofi-api-{env}`, etc.

---

## 8. Regras de Preparação para Fases Futuras

### 8.1 Módulos Stub
- Criar `modules/fiscal/` com `fiscal.module.ts` vazio (apenas Module decorator)
- Criar `modules/societario/` com `societario.module.ts` vazio
- Criar `modules/controle/` com `controle.module.ts` vazio
- NÃO implementar nenhuma lógica nesses módulos

### 8.2 Event Bus
- Implementar EventEmitter2 para eventos de domínio
- Eventos emitidos pelo módulo de OCR: `cartao-ponto.processado`, `cartao-ponto.validado`
- Eventos emitidos pelo módulo de upload: `upload.criado`, `upload.processado`
- Módulos futuros poderão escutar esses eventos sem acoplamento

### 8.3 Feature Flags
- Tabela `feature_flags` com `tenantId`, `feature`, `enabled`
- Guard `@FeatureFlag('fiscal')` que retorna 403 se feature desabilitada
- Isso permite habilitar fases por tenant progressivamente

---

## 9. Regras de Qualidade Obrigatórias

Antes de cada release, verificar checklist (ref: checklist-universal-testes.docx):

- [ ] ESLint: 0 errors, 0 warnings
- [ ] TypeScript: 0 errors
- [ ] Testes de integração: todos passando
- [ ] Testes de isolamento multi-tenant: passando
- [ ] Testes de RBAC: passando
- [ ] Prisma migrate diff: 0 drift
- [ ] Health check retorna 200
- [ ] Env ausente = crash na startup (não runtime)
- [ ] Nenhum `console.log` em código de produção
- [ ] Nenhum `any` no TypeScript
- [ ] Nenhum segredo hardcoded
