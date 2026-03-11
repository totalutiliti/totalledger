# BOOTSTRAP — Guia de Inicialização do Projeto com Antigravity

> **Use este documento como sequência de prompts para o Claude Code (Antigravity).**  
> Cada seção é um prompt ou conjunto de prompts para executar na ordem.

---

## Fase 0: Setup do Monorepo

### Prompt 1 — Criar estrutura base
```
Crie o monorepo SercofiRH com pnpm workspaces. Estrutura:
- apps/api (NestJS)
- apps/web (Next.js 14 App Router)
- packages/shared (tipos e constantes)

Use pnpm init em cada workspace. Configure pnpm-workspace.yaml.
Configure tsconfig base com strict: true.
Configure ESLint e Prettier compartilhados na raiz.

Leia docs/RULES.md e docs/SPECS.md para naming conventions e stack.
```

### Prompt 2 — NestJS Bootstrap
```
No apps/api, inicialize o NestJS com:
- @nestjs/config com validação Zod das env vars (ver docs/SPECS.md seção 6)
- GlobalExceptionFilter com formato de erro padrão (ver docs/RULES.md seção 1.4)
- RequestId interceptor (uuid v4 em toda request)
- Logger configurado para JSON estruturado
- Helmet para security headers
- CORS configurado para FRONTEND_URL
- @nestjs/throttler para rate limiting

O sistema DEVE falhar na startup se DATABASE_URL, JWT_SECRET ou PEPPER_SECRET estiverem ausentes.

Crie o health module com GET /api/v1/health e GET /api/v1/health/ready.
```

### Prompt 3 — Prisma Setup
```
Configure Prisma no apps/api:
- Copie o schema de docs/SPECS.md seção 4
- Configure datasource para PostgreSQL
- Crie a migration inicial
- Configure seed.ts com dados de desenvolvimento:
  - 1 tenant (Sercofi)
  - 2 users (admin + analista)
  - 2 empresas-cliente
  - Alguns funcionários de exemplo
- Hash de senhas com Argon2id + pepper (implementar HashingService primeiro)
```

---

## Fase 1: Auth e Multi-Tenancy

### Prompt 4 — Auth Module
```
Implemente o auth module completo:
- HashingService com Argon2id + pepper (ver docs/RULES.md seção 2.1)
- JWT strategy com passport
- Login, refresh, logout, change-password
- mustChangePassword flow
- Rate limit no login: 5 tentativas/15min

Siga os padrões de controller/service/dto do docs/SKILL.md.
Crie testes de integração em test/integration/auth.spec.ts.
```

### Prompt 5 — Tenant Guard e RLS
```
Implemente multi-tenancy:
- TenantGuard que extrai tenantId do JWT e seta app.current_tenant no PostgreSQL
- RolesGuard com @Roles() decorator
- CurrentTenant() e CurrentUser() decorators
- SQL para habilitar RLS em todas as tabelas (ver docs/SPECS.md seção 4.1)
- PrismaService que executa SET app.current_tenant antes de cada transação

Crie teste de isolamento: dados do tenant A invisíveis para tenant B.
```

---

## Fase 2: CRUD Base

### Prompt 6 — Empresas e Funcionários
```
Implemente os módulos empresa e funcionario:
- CRUD completo com soft delete
- Paginação com meta
- Validação Zod nos DTOs
- RBAC: ADMIN cria/edita, ANALISTA só lista
- Testes de integração

Siga exatamente os padrões do docs/SKILL.md (controller, service, dto, test).
```

---

## Fase 3: Upload e Storage

### Prompt 7 — Upload Module
```
Implemente o upload module:
- POST /api/v1/uploads — upload individual (multipart/form-data)
- POST /api/v1/uploads/batch — upload em lote
- Validação: PDF only, max 20MB
- BlobStorageService para salvar no Azure Blob Storage (Azurite em dev)
- Após salvar, enfileirar job no BullMQ: { uploadId, tenantId }
- Retornar HTTP 202 com uploadId
- GET /api/v1/uploads/:id/status — polling de status

Não implementar o worker OCR ainda, apenas o enfileiramento.
Crie testes de integração.
```

---

## Fase 4: Pipeline OCR

### Prompt 8 — Document Intelligence Service
```
Implemente o DocumentIntelligenceService:
- Chamar Azure Document Intelligence Layout API
- Input: URL do blob ou buffer do PDF
- Output: dados brutos (tabelas, texto, confiança por campo)
- Guardar raw response em ocrRawData (JSONB)
- Timeout: 60 segundos
- Retry com exponential backoff (3 tentativas)
- Log de tokens/custo por chamada

Ver docs/SPECS.md seção 5 para o fluxo completo.
```

### Prompt 9 — Card Parser
```
Implemente o CardParserService:
- Input: raw data do Document Intelligence
- Detectar tipo de cartão (eletrônico/manuscrito/híbrido)
- Extrair cabeçalho: empresa, CNPJ, funcionário, cargo, mês, horário contratual
- Extrair tabela de batidas: mapear linhas (dias) e colunas (entrada/saída)
- Lidar com formatos diferentes (HENRY eletrônico vs manuscrito)
- Retornar CartaoPonto + Batidas estruturados

Use os PDFs de exemplo (LAJE_2.pdf) como referência de formatos.
Crie testes unitários com mocks dos dados do Document Intelligence.
```

### Prompt 10 — Confidence Scorer
```
Implemente o ConfidenceScorerService:
- Input: batidas extraídas + confiança do Document Intelligence
- Regras de scoring:
  - Confiança base do Document Intelligence
  - -0.15 se campo é manuscrito
  - -0.20 se formato não é HH:MM
  - -0.30 se inconsistente (saída < entrada)
  - +0.10 se valor está dentro da faixa esperada pelo horário contratual
- Output: score por campo (0.0 a 1.0) + flag de revisão se < 0.80

Crie testes unitários.
```

### Prompt 11 — AI Filter
```
Implemente o AiFilterService:
- Chamar Azure OpenAI GPT-4o-mini SOMENTE para campos com confiança < 0.80
- Prompt conforme docs/SPECS.md seção 5.2
- Timeout: 30 segundos
- Fallback: se IA falhar, manter valor OCR + flag revisão
- Logar TODA interação: input, output, tokens in/out, latência, custo estimado
- AiCostInterceptor para observabilidade

Crie testes unitários com mock do Azure OpenAI.
```

### Prompt 12 — OCR Worker (Orquestrador)
```
Implemente o OcrPipelineService e o BullMQ processor:
- Worker consome job da fila ocr-queue
- Orquestra: DocIntel → CardParser → ConfidenceScorer → AiFilter → Salvar
- Atualiza status do Upload em cada etapa
- DLQ após 3 falhas
- Testes de integração com mock dos serviços Azure
```

---

## Fase 5: Revisão e Exportação

### Prompt 13 — Revisão Module
```
Implemente o módulo de revisão:
- GET /api/v1/revisao/pendentes — listar cartões pendentes de revisão
- GET /api/v1/revisao/:id — detalhes do cartão com batidas
- PATCH /api/v1/revisao/:id/batidas/:batidaId — corrigir campo
- POST /api/v1/revisao/:id/aprovar — aprovar cartão
- POST /api/v1/revisao/:id/rejeitar — rejeitar (reprocessar)
- Registrar toda ação na tabela revisoes (auditoria)
- Testes de integração
```

### Prompt 14 — Export Module
```
Implemente o módulo de exportação:
- POST /api/v1/export/csv — gerar CSV dos cartões validados
- POST /api/v1/export/xlsx — gerar XLSX formatado
- Filtros: empresaId, mesReferencia
- Salvar arquivo gerado no Blob Storage
- GET /api/v1/export/:id/download — download com SAS token temporário
- Testes de integração
```

---

## Fase 6: Dashboard e Frontend

### Prompt 15 — Dashboard Module (Backend)
```
Implemente o dashboard module:
- GET /api/v1/dashboard/resumo — totais (processados, pendentes, erros, validados)
- GET /api/v1/dashboard/metricas-ocr — taxa de acerto por tipo de cartão
- GET /api/v1/dashboard/processamento — histórico de processamento
- Queries otimizadas com índices
```

### Prompt 16 — Frontend
```
Implemente o frontend Next.js:
- Layout com sidebar (navegação)
- Páginas: Login, Dashboard, Upload, Processamento, Revisão, Empresas, Exportação
- Tela de revisão lado a lado (PDF viewer + editor de campos)
- Upload com drag-and-drop e progress bar
- Dashboard com gráficos (recharts)
- Auth context com JWT
- shadcn/ui para componentes base
- Tailwind CSS
```

---

## Fase 7: Módulos Stub e Feature Flags

### Prompt 17 — Preparação Fases 2-4
```
Crie módulos stub para fases futuras:
- modules/fiscal/fiscal.module.ts — módulo vazio
- modules/societario/societario.module.ts — módulo vazio
- modules/controle/controle.module.ts — módulo vazio

Implemente feature flags:
- Tabela feature_flags (tenantId, feature, enabled)
- FeatureFlagGuard com @FeatureFlag() decorator
- Seed com features: 'rh' (enabled), 'fiscal' (disabled), 'societario' (disabled)

Implemente EventEmitter2:
- Eventos: cartao-ponto.processado, cartao-ponto.validado, upload.criado
- Emitir nos pontos corretos do pipeline
```

---

## Fase 8: Qualidade e Deploy

### Prompt 18 — Checklist Final
```
Percorra o docs/TEST-CHECKLIST.md e verifique TODOS os itens CRÍTICOS:
- Testes de auth (login, logout, token expirado)
- Testes de RBAC (analista não acessa admin)
- Testes de multi-tenant (isolamento)
- Testes de upload (tipo, tamanho)
- Testes de API (status codes, validação)
- Lint: 0 errors
- TypeScript: 0 errors
- Prisma migrate diff: 0 drift
- Health check: 200
- Env ausente: crash na startup
```

### Prompt 19 — Dockerfile e CI
```
Crie Dockerfiles multi-stage para api e web.
Crie GitHub Actions workflow:
- CI: lint, type-check, test em PR
- CD: build, push ACR, deploy Container Apps em merge na main
Crie infra/bicep/ com templates para todos os recursos Azure.
```
