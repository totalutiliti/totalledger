# SPECS — SercofiRH: Especificação Técnica

## 1. Stack Tecnológica

| Camada | Tecnologia | Justificativa |
|--------|-----------|---------------|
| **Backend** | NestJS (Node.js 20+) | Padrão TotalUtiliti; DI nativa; modules para domínios |
| **Frontend** | Next.js 14+ (App Router) | Padrão TotalUtiliti; SSR; RSC |
| **Banco** | PostgreSQL 16 (Azure Flexible Server) | RLS nativo; JSONB para dados semi-estruturados |
| **ORM** | Prisma | Padrão TotalUtiliti; type-safe; migrations |
| **OCR** | Azure Document Intelligence (Layout + Custom) | Suporte a manuscrito; custom models treináveis |
| **IA** | Azure OpenAI (GPT-4o-mini) | Filtro inteligente para campos ambíguos; custo otimizado |
| **Storage** | Azure Blob Storage | PDFs originais; retenção longa; tiers de custo |
| **Filas** | BullMQ + Redis | Processamento assíncrono de OCR; DLQ; retry |
| **Deploy** | Azure Container Apps | Scale-to-zero; padrão TotalUtiliti |
| **Registry** | Azure Container Registry | Imagens Docker |
| **Segredos** | Azure Key Vault | Padrão TotalUtiliti |
| **Monitoramento** | Azure Application Insights | Logs, métricas, traces |
| **Package Manager** | pnpm | Padrão TotalUtiliti |

---

## 2. Arquitetura de Alto Nível

```
┌──────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Next.js)                        │
│   Upload │ Revisão │ Dashboard │ Gestão │ Exportação             │
└─────────────────────────┬────────────────────────────────────────┘
                          │ HTTPS / JWT
┌─────────────────────────▼────────────────────────────────────────┐
│                     BACKEND (NestJS)                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │   Auth   │ │  Upload  │ │ Revisão  │ │ Empresa  │           │
│  │  Module  │ │  Module  │ │  Module  │ │  Module  │           │
│  └──────────┘ └────┬─────┘ └──────────┘ └──────────┘           │
│  ┌──────────┐ ┌────▼─────┐ ┌──────────┐ ┌──────────┐           │
│  │ Dashboard│ │   OCR    │ │  Export  │ │  Audit   │           │
│  │  Module  │ │ Pipeline │ │  Module  │ │  Module  │           │
│  └──────────┘ │  Module  │ └──────────┘ └──────────┘           │
│               └────┬─────┘                                      │
│  ┌──────────────┐  │  ┌───────────────┐                         │
│  │ Tenant/RLS   │  │  │  Queue (Bull) │                         │
│  │   Guard      │  │  │   Workers     │                         │
│  └──────────────┘  │  └───────┬───────┘                         │
│                    │          │                                   │
│  ── DOMÍNIOS FUTUROS (vazios) ─────────────────────────         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                        │
│  │  Fiscal  │ │Societário│ │ Controle │                        │
│  │ (stub)   │ │  (stub)  │ │  (stub)  │                        │
│  └──────────┘ └──────────┘ └──────────┘                        │
└──────────────────────┬───────────┬───────────────────────────────┘
                       │           │
          ┌────────────▼──┐  ┌─────▼──────────┐
          │  PostgreSQL   │  │  Azure Blob    │
          │  (RLS)        │  │  Storage       │
          └───────────────┘  └────────────────┘

          ┌───────────────┐  ┌────────────────┐
          │  Azure Doc    │  │  Azure OpenAI  │
          │  Intelligence │  │  (GPT-4o-mini) │
          └───────────────┘  └────────────────┘
```

---

## 3. Estrutura do Monorepo

```
sercofi-rh/
├── apps/
│   ├── api/                          # NestJS Backend
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/               # Shared: guards, filters, interceptors, decorators
│   │   │   │   ├── guards/
│   │   │   │   │   ├── jwt-auth.guard.ts
│   │   │   │   │   ├── roles.guard.ts
│   │   │   │   │   └── tenant.guard.ts
│   │   │   │   ├── filters/
│   │   │   │   │   └── global-exception.filter.ts
│   │   │   │   ├── interceptors/
│   │   │   │   │   ├── request-id.interceptor.ts
│   │   │   │   │   ├── audit.interceptor.ts
│   │   │   │   │   └── ai-cost.interceptor.ts
│   │   │   │   ├── decorators/
│   │   │   │   │   ├── current-user.decorator.ts
│   │   │   │   │   ├── current-tenant.decorator.ts
│   │   │   │   │   └── roles.decorator.ts
│   │   │   │   ├── dto/
│   │   │   │   │   └── pagination.dto.ts
│   │   │   │   └── pipes/
│   │   │   │       └── zod-validation.pipe.ts
│   │   │   │
│   │   │   ├── modules/
│   │   │   │   ├── auth/              # Autenticação e autorização
│   │   │   │   │   ├── auth.module.ts
│   │   │   │   │   ├── auth.controller.ts
│   │   │   │   │   ├── auth.service.ts
│   │   │   │   │   ├── strategies/
│   │   │   │   │   │   └── jwt.strategy.ts
│   │   │   │   │   ├── dto/
│   │   │   │   │   └── hashing/
│   │   │   │   │       └── hashing.service.ts     # Argon2id + pepper
│   │   │   │   │
│   │   │   │   ├── tenant/            # Gestão de tenants (contabilidades)
│   │   │   │   │   ├── tenant.module.ts
│   │   │   │   │   ├── tenant.controller.ts
│   │   │   │   │   ├── tenant.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   │
│   │   │   │   ├── empresa/           # Empresas-cliente da contabilidade
│   │   │   │   │   ├── empresa.module.ts
│   │   │   │   │   ├── empresa.controller.ts
│   │   │   │   │   ├── empresa.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   │
│   │   │   │   ├── funcionario/       # Funcionários das empresas-cliente
│   │   │   │   │   ├── funcionario.module.ts
│   │   │   │   │   ├── funcionario.controller.ts
│   │   │   │   │   ├── funcionario.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   │
│   │   │   │   ├── upload/            # Upload e ingestão de PDFs
│   │   │   │   │   ├── upload.module.ts
│   │   │   │   │   ├── upload.controller.ts
│   │   │   │   │   ├── upload.service.ts
│   │   │   │   │   ├── blob-storage.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   │
│   │   │   │   ├── ocr-pipeline/      # Pipeline OCR + IA
│   │   │   │   │   ├── ocr-pipeline.module.ts
│   │   │   │   │   ├── ocr-pipeline.service.ts       # Orquestrador
│   │   │   │   │   ├── document-intelligence.service.ts  # Azure Doc Intel
│   │   │   │   │   ├── ai-filter.service.ts           # Azure OpenAI filter
│   │   │   │   │   ├── card-parser.service.ts         # Parsing estruturado
│   │   │   │   │   ├── confidence-scorer.service.ts   # Scoring de confiança
│   │   │   │   │   ├── processors/
│   │   │   │   │   │   ├── ocr.processor.ts           # Bull worker
│   │   │   │   │   │   └── ocr.queue.ts               # Queue config
│   │   │   │   │   └── dto/
│   │   │   │   │
│   │   │   │   ├── revisao/           # Revisão e validação humana
│   │   │   │   │   ├── revisao.module.ts
│   │   │   │   │   ├── revisao.controller.ts
│   │   │   │   │   ├── revisao.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   │
│   │   │   │   ├── export/            # Exportação de dados
│   │   │   │   │   ├── export.module.ts
│   │   │   │   │   ├── export.controller.ts
│   │   │   │   │   ├── export.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   │
│   │   │   │   ├── dashboard/         # Dashboard e relatórios
│   │   │   │   │   ├── dashboard.module.ts
│   │   │   │   │   ├── dashboard.controller.ts
│   │   │   │   │   ├── dashboard.service.ts
│   │   │   │   │   └── dto/
│   │   │   │   │
│   │   │   │   ├── audit/             # Auditoria
│   │   │   │   │   ├── audit.module.ts
│   │   │   │   │   └── audit.service.ts
│   │   │   │   │
│   │   │   │   └── health/            # Health checks
│   │   │   │       ├── health.module.ts
│   │   │   │       └── health.controller.ts
│   │   │   │
│   │   │   └── config/
│   │   │       ├── env.validation.ts   # Zod schema para env vars
│   │   │       └── configuration.ts
│   │   │
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   │
│   │   ├── test/
│   │   │   ├── setup.ts
│   │   │   ├── helpers/
│   │   │   │   ├── test-app.helper.ts
│   │   │   │   ├── auth.helper.ts
│   │   │   │   └── seed.helper.ts
│   │   │   ├── integration/
│   │   │   │   ├── auth.spec.ts
│   │   │   │   ├── upload.spec.ts
│   │   │   │   ├── ocr-pipeline.spec.ts
│   │   │   │   ├── revisao.spec.ts
│   │   │   │   └── tenant-isolation.spec.ts
│   │   │   └── unit/
│   │   │       ├── card-parser.spec.ts
│   │   │       ├── confidence-scorer.spec.ts
│   │   │       └── hashing.spec.ts
│   │   │
│   │   ├── Dockerfile
│   │   ├── .env.example
│   │   ├── nest-cli.json
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── web/                           # Next.js Frontend
│       ├── src/
│       │   ├── app/
│       │   │   ├── layout.tsx
│       │   │   ├── page.tsx
│       │   │   ├── (auth)/
│       │   │   │   ├── login/page.tsx
│       │   │   │   └── forgot-password/page.tsx
│       │   │   └── (dashboard)/
│       │   │       ├── layout.tsx
│       │   │       ├── page.tsx              # Dashboard
│       │   │       ├── upload/page.tsx
│       │   │       ├── processamento/page.tsx
│       │   │       ├── revisao/
│       │   │       │   ├── page.tsx           # Lista
│       │   │       │   └── [id]/page.tsx      # Revisão lado a lado
│       │   │       ├── empresas/page.tsx
│       │   │       ├── funcionarios/page.tsx
│       │   │       ├── exportacao/page.tsx
│       │   │       └── configuracoes/page.tsx
│       │   ├── components/
│       │   │   ├── ui/                # Componentes base (shadcn/ui)
│       │   │   ├── layout/            # Header, Sidebar, etc.
│       │   │   ├── upload/            # Dropzone, progress, etc.
│       │   │   ├── revisao/           # PDF viewer, editor de campos
│       │   │   └── dashboard/         # Charts, cards, etc.
│       │   ├── lib/
│       │   │   ├── api.ts             # API client (fetch wrapper)
│       │   │   ├── auth.ts            # Auth helpers
│       │   │   └── utils.ts
│       │   ├── hooks/
│       │   └── types/
│       │
│       ├── public/
│       ├── Dockerfile
│       ├── next.config.js
│       ├── tailwind.config.ts
│       ├── tsconfig.json
│       └── package.json
│
├── packages/                          # Shared packages
│   └── shared/
│       ├── src/
│       │   ├── types/                 # Tipos compartilhados
│       │   │   ├── auth.types.ts
│       │   │   ├── tenant.types.ts
│       │   │   ├── ponto.types.ts
│       │   │   └── api-response.types.ts
│       │   ├── constants/
│       │   │   ├── roles.ts
│       │   │   ├── status.ts
│       │   │   └── errors.ts
│       │   └── validators/
│       │       └── ponto.validators.ts
│       ├── tsconfig.json
│       └── package.json
│
├── infra/                             # IaC
│   ├── bicep/                         # Azure Bicep templates
│   │   ├── main.bicep
│   │   ├── modules/
│   │   │   ├── container-app.bicep
│   │   │   ├── postgresql.bicep
│   │   │   ├── blob-storage.bicep
│   │   │   ├── key-vault.bicep
│   │   │   ├── redis.bicep
│   │   │   ├── document-intelligence.bicep
│   │   │   ├── openai.bicep
│   │   │   └── app-insights.bicep
│   │   └── parameters/
│   │       ├── dev.bicepparam
│   │       └── prod.bicepparam
│   └── scripts/
│       ├── deploy.sh
│       ├── start-dev.bat
│       └── stop-dev.bat
│
├── docs/                              # Documentação
│   ├── PRD.md
│   ├── SPECS.md
│   ├── RULES.md
│   ├── SKILL.md
│   ├── ADR/
│   │   └── 001-stack-selection.md
│   └── runbooks/
│       ├── deploy.md
│       └── disaster-recovery.md
│
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── cd.yml
│
├── docker-compose.yml                 # Dev environment
├── docker-compose.test.yml            # Test environment
├── pnpm-workspace.yaml
├── .eslintrc.js
├── .prettierrc
├── .env.example
├── README.md
└── CHANGELOG.md
```

---

## 4. Modelo de Dados (Prisma Schema)

```prisma
// ============================================
// MULTI-TENANCY
// ============================================

model Tenant {
  id          String   @id @default(uuid())
  nome        String                          // "Sercofi Contabilidade"
  cnpj        String   @unique
  plano       Plano    @default(STARTER)
  ativo       Boolean  @default(true)
  suspenso    Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  usuarios    User[]
  empresas    Empresa[]
  uploads     Upload[]

  @@map("tenants")
}

enum Plano {
  STARTER
  PROFESSIONAL
  ENTERPRISE
}

// ============================================
// AUTENTICAÇÃO E AUTORIZAÇÃO
// ============================================

model User {
  id                  String   @id @default(uuid())
  tenantId            String
  email               String
  passwordHash        String
  nome                String
  role                Role     @default(ANALISTA)
  ativo               Boolean  @default(true)
  mustChangePassword  Boolean  @default(true)
  lastLoginAt         DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  createdBy           String?
  updatedBy           String?

  tenant              Tenant   @relation(fields: [tenantId], references: [id])
  revisoes            Revisao[]
  auditLogs           AuditLog[]

  @@unique([tenantId, email])
  @@index([tenantId])
  @@map("users")
}

enum Role {
  SUPER_ADMIN    // TotalUtiliti — cross-tenant
  ADMIN          // Admin do tenant (Sercofi)
  SUPERVISOR     // Supervisor de equipe
  ANALISTA       // Analista de RH
}

// ============================================
// EMPRESAS-CLIENTE
// ============================================

model Empresa {
  id              String   @id @default(uuid())
  tenantId        String
  razaoSocial     String
  cnpj            String
  nomeFantasia    String?
  contato         String?
  telefone        String?
  email           String?

  // Configuração de jornada padrão
  jornadaSegSex   String?  // "07:00-16:00"
  intervaloAlmoco String?  // "11:00-12:00"
  jornadaSabado   String?  // "07:00-11:00"

  ativo           Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  createdBy       String?
  updatedBy       String?

  tenant          Tenant   @relation(fields: [tenantId], references: [id])
  funcionarios    Funcionario[]
  uploads         Upload[]

  @@unique([tenantId, cnpj])
  @@index([tenantId])
  @@map("empresas")
}

// ============================================
// FUNCIONÁRIOS
// ============================================

model Funcionario {
  id              String   @id @default(uuid())
  tenantId        String
  empresaId       String
  nome            String
  cargo           String?
  cpf             String?          // PII — criptografar em campo
  matricula       String?
  ativo           Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  empresa         Empresa  @relation(fields: [empresaId], references: [id])
  cartoesPonto    CartaoPonto[]

  @@unique([tenantId, empresaId, cpf])
  @@index([tenantId])
  @@index([empresaId])
  @@map("funcionarios")
}

// ============================================
// UPLOAD E PROCESSAMENTO
// ============================================

model Upload {
  id              String        @id @default(uuid())
  tenantId        String
  empresaId       String
  userId          String                          // Quem fez upload
  mesReferencia   String                          // "2024-12"
  nomeArquivo     String
  blobUrl         String                          // URL no Blob Storage
  blobPath        String                          // Path no container
  tamanhoBytes    Int
  totalPaginas    Int?
  status          UploadStatus  @default(AGUARDANDO)
  erroMensagem    String?
  processadoEm    DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  tenant          Tenant        @relation(fields: [tenantId], references: [id])
  empresa         Empresa       @relation(fields: [empresaId], references: [id])
  cartoesPonto    CartaoPonto[]

  @@index([tenantId])
  @@index([tenantId, status])
  @@index([empresaId, mesReferencia])
  @@map("uploads")
}

enum UploadStatus {
  AGUARDANDO       // Na fila
  PROCESSANDO      // OCR em andamento
  PROCESSADO       // OCR concluído, aguardando revisão
  ERRO             // Falha no processamento
  VALIDADO         // Todos os cartões revisados e aprovados
  EXPORTADO        // Dados já exportados
}

// ============================================
// CARTÃO DE PONTO (dados extraídos)
// ============================================

model CartaoPonto {
  id                String           @id @default(uuid())
  tenantId          String
  uploadId          String
  funcionarioId     String?          // Null até vincular ao funcionário
  paginaPdf         Int              // Página do PDF de onde veio

  // Cabeçalho extraído
  nomeExtraido      String?          // Nome como lido pelo OCR
  cargoExtraido     String?
  mesExtraido       String?
  empresaExtraida   String?
  cnpjExtraido      String?
  horarioContratual String?          // "07:00-16:00 int 11:00-12:00"

  // Tipo de cartão detectado
  tipoCartao        TipoCartao       @default(DESCONHECIDO)

  // Status de revisão
  statusRevisao     StatusRevisao    @default(PENDENTE)

  // Confiança geral (média dos campos)
  confiancaGeral    Float?           // 0.0 a 1.0

  // Dados brutos do OCR (JSON completo para debug)
  ocrRawData        Json?

  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt

  upload            Upload           @relation(fields: [uploadId], references: [id])
  funcionario       Funcionario?     @relation(fields: [funcionarioId], references: [id])
  batidas           Batida[]
  revisoes          Revisao[]

  @@index([tenantId])
  @@index([uploadId])
  @@index([tenantId, statusRevisao])
  @@map("cartoes_ponto")
}

enum TipoCartao {
  ELETRONICO       // Relógio eletrônico (ex: HENRY)
  MANUSCRITO       // Preenchido à mão
  HIBRIDO          // Eletrônico com correções manuscritas
  DESCONHECIDO
}

enum StatusRevisao {
  PENDENTE         // Aguardando revisão humana
  EM_REVISAO       // Analista revisando
  APROVADO         // Revisado e aprovado
  REJEITADO        // Rejeitado — requer reprocessamento
}

// ============================================
// BATIDAS (linhas do cartão de ponto)
// ============================================

model Batida {
  id                String   @id @default(uuid())
  tenantId          String
  cartaoPontoId     String
  dia               Int                        // 1-31
  diaSemana         String?                    // "Seg", "Ter", etc.

  // Valores extraídos pelo OCR
  entradaManha      String?                    // "07:25"
  saidaManha        String?                    // "11:33"
  entradaTarde      String?                    // "12:59"
  saidaTarde        String?                    // "18:02"
  entradaExtra      String?
  saidaExtra        String?

  // Valores corrigidos pelo analista (null = sem correção)
  entradaManhaCorrigida   String?
  saidaManhaCorrigida     String?
  entradaTardeCorrigida   String?
  saidaTardeCorrigida     String?
  entradaExtraCorrigida   String?
  saidaExtraCorrigida     String?

  // Horas calculadas
  horasNormais      Float?                     // Em minutos
  horasExtras       Float?                     // Em minutos

  // Confiança por campo (0.0 a 1.0)
  confianca         Json?                      // { entradaManha: 0.95, saidaManha: 0.60, ... }

  // Flags
  isManuscrito      Boolean  @default(false)   // Campo tinha escrita à mão?
  isInconsistente   Boolean  @default(false)   // Horários inconsistentes?
  isFaltaDia        Boolean  @default(false)   // Sem batidas (falta/folga/feriado)
  observacao        String?

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  cartaoPonto       CartaoPonto @relation(fields: [cartaoPontoId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@index([cartaoPontoId])
  @@unique([cartaoPontoId, dia])
  @@map("batidas")
}

// ============================================
// REVISÃO E AUDITORIA
// ============================================

model Revisao {
  id              String   @id @default(uuid())
  tenantId        String
  cartaoPontoId   String
  userId          String
  acao            AcaoRevisao
  campo           String?                      // "batida.dia5.saidaManha"
  valorAnterior   String?
  valorNovo       String?
  observacao      String?
  createdAt       DateTime @default(now())

  cartaoPonto     CartaoPonto @relation(fields: [cartaoPontoId], references: [id])
  user            User        @relation(fields: [userId], references: [id])

  @@index([tenantId])
  @@index([cartaoPontoId])
  @@map("revisoes")
}

enum AcaoRevisao {
  CORRECAO         // Corrigiu valor extraído
  APROVACAO        // Aprovou cartão
  REJEICAO         // Rejeitou cartão
  OBSERVACAO       // Adicionou observação
}

model AuditLog {
  id          String   @id @default(uuid())
  tenantId    String
  userId      String
  acao        String                          // "upload.create", "revisao.aprovar"
  entidade    String                          // "Upload", "CartaoPonto"
  entidadeId  String
  dados       Json?                           // Snapshot do antes/depois
  ip          String?
  userAgent   String?
  createdAt   DateTime @default(now())

  user        User     @relation(fields: [userId], references: [id])

  @@index([tenantId])
  @@index([tenantId, entidade, entidadeId])
  @@index([createdAt])
  @@map("audit_logs")
}
```

### 4.1 RLS Policies (SQL)

```sql
-- Habilitar RLS
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE funcionarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE cartoes_ponto ENABLE ROW LEVEL SECURITY;
ALTER TABLE batidas ENABLE ROW LEVEL SECURITY;
ALTER TABLE revisoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy padrão: filtro por tenant
-- app_user role usa SET app.current_tenant = 'uuid' antes de cada transação
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- Repetir para todas as tabelas com tenantId
-- SUPER_ADMIN bypassa RLS via role separada no PostgreSQL
```

---

## 5. Pipeline OCR + IA — Fluxo Detalhado

### 5.1 Fluxo de Processamento

```
Upload PDF
    │
    ▼
[1] Validação (tipo, tamanho, páginas)
    │
    ▼
[2] Blob Storage (salvar original)
    │
    ▼
[3] Fila BullMQ (job: ocr-process)
    │
    ▼
[4] Worker: Azure Document Intelligence
    │   ├── Layout API (extração de tabelas e texto)
    │   └── Se custom model disponível: Custom Model
    │
    ▼
[5] Card Parser (estruturar dados brutos)
    │   ├── Detectar tipo de cartão (eletrônico/manuscrito/híbrido)
    │   ├── Extrair cabeçalho (regex + heurísticas)
    │   └── Extrair tabela de batidas (mapear linhas/colunas)
    │
    ▼
[6] Confidence Scorer (pontuar confiança)
    │   ├── Confiança do Document Intelligence por campo
    │   ├── Validação de formato (HH:MM?)
    │   ├── Validação lógica (entrada < saída?)
    │   └── Gerar flag de revisão se confiança < threshold
    │
    ▼
[7] AI Filter (Azure OpenAI) — SOMENTE para campos ambíguos
    │   ├── Input: imagem do campo + valor OCR + contexto
    │   ├── Prompt: "Qual horário está escrito? É XX:XX ou YY:YY?"
    │   └── Output: valor corrigido + confiança
    │
    ▼
[8] Salvar no banco (CartaoPonto + Batidas)
    │
    ▼
[9] Atualizar status do Upload → PROCESSADO
    │
    ▼
[10] Notificar frontend (WebSocket ou polling)
```

### 5.2 Prompt do AI Filter

```
Você é um especialista em leitura de cartões de ponto brasileiros.

CONTEXTO:
- Empresa: {{empresa}}
- Funcionário: {{funcionario}}
- Horário contratual: {{horarioContratual}}
- Dia: {{dia}} ({{diaSemana}})

O OCR extraiu o seguinte valor para o campo "{{campo}}": "{{valorOCR}}"
Nível de confiança do OCR: {{confianca}}

O campo é um horário no formato HH:MM (24h).
Horários típicos para este campo: {{faixaEsperada}}

TAREFA:
1. Analise se o valor extraído é plausível para este campo.
2. Se plausível, confirme o valor.
3. Se ambíguo ou implausível, sugira a correção mais provável.
4. Indique seu nível de confiança (0.0 a 1.0).

RESPONDA APENAS em JSON:
{
  "valorOriginal": "...",
  "valorCorrigido": "...",
  "confianca": 0.0,
  "justificativa": "..."
}
```

### 5.3 Estratégia de Custo

- **Document Intelligence:** cobrado por página. Para cartões de ponto, cada PDF tem tipicamente 1-2 páginas.
- **Azure OpenAI:** usar GPT-4o-mini (custo baixo). Chamar SOMENTE para campos com confiança < 0.80 (evitar chamadas desnecessárias).
- **Cache:** se o mesmo padrão de cartão já foi processado (mesmo layout), reutilizar mapeamento de colunas.

---

## 6. Variáveis de Ambiente

```env
# ==========================================
# APP
# ==========================================
NODE_ENV=development
PORT=3000
API_VERSION=v1
FRONTEND_URL=http://localhost:3001

# ==========================================
# DATABASE
# ==========================================
DATABASE_URL=postgresql://user:pass@localhost:5432/sercofi_rh

# ==========================================
# AUTH
# ==========================================
JWT_SECRET=your-jwt-secret
JWT_EXPIRES_IN=8h
JWT_REFRESH_EXPIRES_IN=7d
PEPPER_SECRET=your-pepper-secret-from-keyvault

# ==========================================
# AZURE BLOB STORAGE
# ==========================================
AZURE_STORAGE_CONNECTION_STRING=
AZURE_STORAGE_CONTAINER_NAME=cartoes-ponto

# ==========================================
# AZURE DOCUMENT INTELLIGENCE
# ==========================================
AZURE_DOC_INTEL_ENDPOINT=https://xxx.cognitiveservices.azure.com
AZURE_DOC_INTEL_KEY=

# ==========================================
# AZURE OPENAI
# ==========================================
AZURE_OPENAI_ENDPOINT=https://xxx.openai.azure.com
AZURE_OPENAI_KEY=
AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini
AZURE_OPENAI_API_VERSION=2024-10-01-preview

# ==========================================
# REDIS (BullMQ)
# ==========================================
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# ==========================================
# AZURE APPLICATION INSIGHTS
# ==========================================
APPLICATIONINSIGHTS_CONNECTION_STRING=

# ==========================================
# AZURE KEY VAULT
# ==========================================
AZURE_KEY_VAULT_URL=https://xxx.vault.azure.net
```

---

## 7. API Routes (v1)

### Auth
```
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
POST   /api/v1/auth/forgot-password
POST   /api/v1/auth/reset-password
PUT    /api/v1/auth/change-password
```

### Tenants (SUPER_ADMIN)
```
GET    /api/v1/tenants
POST   /api/v1/tenants
GET    /api/v1/tenants/:id
PATCH  /api/v1/tenants/:id
DELETE /api/v1/tenants/:id
```

### Empresas
```
GET    /api/v1/empresas
POST   /api/v1/empresas
GET    /api/v1/empresas/:id
PATCH  /api/v1/empresas/:id
DELETE /api/v1/empresas/:id
```

### Funcionários
```
GET    /api/v1/funcionarios
POST   /api/v1/funcionarios
GET    /api/v1/funcionarios/:id
PATCH  /api/v1/funcionarios/:id
DELETE /api/v1/funcionarios/:id
```

### Uploads
```
GET    /api/v1/uploads
POST   /api/v1/uploads                    # Upload individual
POST   /api/v1/uploads/batch              # Upload em lote
GET    /api/v1/uploads/:id
GET    /api/v1/uploads/:id/status
POST   /api/v1/uploads/:id/reprocess
DELETE /api/v1/uploads/:id
```

### Cartões de Ponto
```
GET    /api/v1/cartoes-ponto
GET    /api/v1/cartoes-ponto/:id
GET    /api/v1/cartoes-ponto/:id/batidas
```

### Revisão
```
GET    /api/v1/revisao/pendentes
GET    /api/v1/revisao/:cartaoPontoId
PATCH  /api/v1/revisao/:cartaoPontoId/batidas/:batidaId
POST   /api/v1/revisao/:cartaoPontoId/aprovar
POST   /api/v1/revisao/:cartaoPontoId/rejeitar
GET    /api/v1/revisao/:cartaoPontoId/historico
```

### Exportação
```
POST   /api/v1/export/csv
POST   /api/v1/export/xlsx
GET    /api/v1/export/:id/download
```

### Dashboard
```
GET    /api/v1/dashboard/resumo
GET    /api/v1/dashboard/metricas-ocr
GET    /api/v1/dashboard/processamento
```

### Health
```
GET    /api/v1/health
GET    /api/v1/health/ready
```

---

## 8. Docker Compose (Desenvolvimento)

```yaml
version: "3.8"

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: sercofi_rh
      POSTGRES_USER: sercofi
      POSTGRES_PASSWORD: sercofi_dev_123
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  azurite:
    image: mcr.microsoft.com/azure-storage/azurite
    ports:
      - "10000:10000"  # Blob
      - "10001:10001"  # Queue
      - "10002:10002"  # Table

volumes:
  postgres_data:
```

---

## 9. Classificação de Dados (LGPD)

| Campo | Classificação | Log? | Criptografia | Retenção |
|-------|--------------|------|-------------|----------|
| Funcionário.nome | PII | Mascarado | Em trânsito | 5 anos |
| Funcionário.cpf | PII | Nunca | Em campo (AES-256) | 5 anos |
| User.passwordHash | Credencial | Nunca | Argon2id + pepper | Enquanto ativo |
| Batida.* (horários) | Dados trabalhistas | Sim | Em trânsito | 5 anos (CLT) |
| Upload.blobUrl | Interno | Sim | Em trânsito | 5 anos |
| AuditLog.* | Auditoria | Sim | Em trânsito | 5 anos |
