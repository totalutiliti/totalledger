# ADR-001: Seleção de Stack Tecnológica

**Status:** Aceito  
**Data:** 2026-03-11  
**Autor:** João / TotalUtiliti  

## Contexto

A Sercofi Contabilidade precisa de um sistema para automatizar o processamento de cartões de ponto de seus clientes. O sistema deve:

- Processar PDFs com OCR (cartões eletrônicos e manuscritos)
- Usar IA para interpretar campos ambíguos
- Suportar multi-tenancy (preparar para outras contabilidades)
- Escalar de dezenas a milhares de cartões/mês
- Integrar com serviços Azure

## Decisão

### Backend: NestJS
- Padrão consolidado na TotalUtiliti (KegSafe, VidroSaaS, Total Talent)
- Module system alinha com bounded contexts
- DI nativa facilita testabilidade
- Ecossistema maduro para queues (BullMQ), auth (Passport), validation

### Frontend: Next.js 14 (App Router)
- Padrão consolidado na TotalUtiliti
- Server Components para performance
- SSR para SEO (não crítico aqui, mas bom para futuro)
- Ecossistema React maduro para componentes de revisão (PDF viewer, editor)

### Banco: PostgreSQL 16 + Prisma
- RLS nativo para multi-tenancy (padrão TotalUtiliti)
- JSONB para dados semi-estruturados do OCR
- Prisma type-safe com migrations
- Azure Flexible Server com suporte a read replicas

### OCR: Azure Document Intelligence
- Já usado no Total Talent (OCR de currículos) — expertise existente
- Layout API extrai tabelas estruturadas (ideal para cartões de ponto)
- Custom Models treináveis com exemplos reais
- Suporte a manuscrito (handwriting recognition)

### IA: Azure OpenAI (GPT-4o-mini)
- Custo otimizado vs GPT-4o (10x mais barato)
- Suficiente para interpretação de campos de horário
- Integração nativa com Azure (Key Vault, managed identity)
- Mesma infra dos outros projetos TotalUtiliti

### Filas: BullMQ + Redis
- Simples, maduro, bem documentado
- DLQ nativa
- Dashboard de monitoramento (Bull Board)
- Retry com exponential backoff nativo

### Storage: Azure Blob Storage
- Retenção longa (5 anos — requisito trabalhista)
- Tiers de custo (hot → cool → archive)
- SAS tokens para acesso temporário
- Integração direta com Document Intelligence

## Alternativas Consideradas

| Alternativa | Motivo da Rejeição |
|-------------|-------------------|
| Google Document AI | Ecossistema é Azure; não Google Cloud |
| Tesseract (open source) | Acurácia muito inferior para manuscrito |
| AWS Textract | Ecossistema é Azure |
| RabbitMQ | BullMQ mais simples para o volume esperado |
| MongoDB | PostgreSQL com RLS é padrão consolidado |

## Consequências

- **Positivas:** reutilização de expertise, deploy patterns e IaC de outros projetos TotalUtiliti
- **Negativas:** dependência de Azure; custo de Document Intelligence por página processada
- **Riscos:** acurácia de OCR em manuscritos pode ser insuficiente → mitigação: AI Filter + revisão humana

---

# ADR-002: Estratégia de Multi-Tenancy

**Status:** Aceito  
**Data:** 2026-03-11  

## Contexto

O MVP é para a Sercofi, mas a arquitetura deve suportar outras contabilidades no futuro. Dentro de cada contabilidade (tenant), há múltiplas empresas-cliente cujos funcionários têm cartões de ponto.

## Decisão

- **Nível 1 (Tenant):** Contabilidade (ex: Sercofi). Isolamento total via RLS.
- **Nível 2 (Empresa):** Empresa-cliente da contabilidade (ex: Construlaje). Isolamento por `empresaId` dentro do tenant.
- **Banco compartilhado** com RLS (não banco por tenant). Escala suficiente para o volume esperado.
- **SUPER_ADMIN** (TotalUtiliti) é cross-tenant via role PostgreSQL separada.

## Consequências

- Simples de implementar e operar (um banco só)
- RLS garante isolamento sem depender da aplicação
- Se escalar para centenas de tenants, considerar sharding (ADR futuro)

---

# ADR-003: Pipeline OCR Assíncrono com Fila

**Status:** Aceito  
**Data:** 2026-03-11  

## Contexto

Processar um PDF com Document Intelligence + OpenAI pode levar 10-30 segundos. Bloquear a requisição HTTP é inaceitável para UX.

## Decisão

- Upload retorna HTTP 202 (Accepted) imediatamente
- Job enfileirado no BullMQ com dados mínimos: `{ uploadId, tenantId }`
- Worker separado processa o job
- Frontend faz polling em `/uploads/:id/status` (futuro: WebSocket)
- DLQ para falhas após 3 tentativas
- Status tracking: AGUARDANDO → PROCESSANDO → PROCESSADO/ERRO

## Consequências

- UX responsiva (upload instantâneo)
- Resiliência (retry automático, DLQ)
- Complexidade adicional (Redis, worker, status tracking)
