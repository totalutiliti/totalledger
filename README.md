# SercofiRH — Automação Inteligente de Ponto e Folha

Sistema SaaS multi-tenant para automação do processamento de cartões de ponto usando OCR + IA, desenvolvido para a [Sercofi Contabilidade](https://www.sercofi.com.br/).

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | NestJS + TypeScript |
| Frontend | Next.js 14 (App Router) |
| Banco | PostgreSQL 16 + Prisma + RLS |
| OCR | Azure Document Intelligence |
| IA | Azure OpenAI (GPT-5.2-chat) |
| Filas | BullMQ + Redis |
| Storage | Azure Blob Storage |
| Deploy | Azure Container Apps |

## Pré-requisitos

- Node.js 20+
- pnpm 8+
- Docker e Docker Compose
- Azure CLI (para deploy)

## Setup Local

```bash
# 1. Clonar
git clone https://github.com/totalutiliti/sercofi-rh.git
cd sercofi-rh

# 2. Instalar dependências
pnpm install

# 3. Subir infraestrutura local
docker-compose up -d

# 4. Configurar env
cp apps/api/.env.example apps/api/.env
# Editar .env com suas credenciais Azure

# 5. Rodar migrations e seed
cd apps/api
pnpm prisma migrate dev
pnpm prisma db seed

# 6. Iniciar backend
pnpm run start:dev

# 7. Em outro terminal — iniciar frontend
cd apps/web
pnpm run dev
```

## Scripts

```bash
# Backend
pnpm --filter api run start:dev      # Dev com hot reload
pnpm --filter api run build          # Build
pnpm --filter api run test           # Testes
pnpm --filter api run test:e2e       # Testes E2E
pnpm --filter api run lint           # Lint

# Frontend
pnpm --filter web run dev            # Dev
pnpm --filter web run build          # Build
pnpm --filter web run lint           # Lint

# Prisma
pnpm --filter api run prisma migrate dev      # Criar migration
pnpm --filter api run prisma migrate deploy   # Aplicar migrations
pnpm --filter api run prisma db seed          # Seed
pnpm --filter api run prisma studio           # UI do Prisma
```

## Estrutura

```
sercofi-rh/
├── apps/
│   ├── api/          # NestJS Backend
│   └── web/          # Next.js Frontend
├── packages/
│   └── shared/       # Tipos e constantes compartilhados
├── infra/            # Bicep (IaC)
├── docs/             # Documentação
│   ├── PRD.md        # Requisitos do produto
│   ├── SPECS.md      # Especificação técnica
│   ├── RULES.md      # Regras de desenvolvimento
│   ├── SKILL.md      # Instruções para Antigravity
│   └── ADR/          # Architecture Decision Records
└── docker-compose.yml
```

## Pipeline OCR + IA

O sistema usa dois serviços de IA com papeis distintos:

### 1. Azure Document Intelligence (OCR)

- **Papel:** Extrair texto e tabelas do PDF do cartao de ponto
- **Modelo:** `prebuilt-layout` (Layout API)
- **Entrada:** Buffer do PDF (baixado do Azure Blob Storage)
- **Saida:** Cada valor de texto com coordenadas e **nivel de confianca** (0.0 a 1.0)
- Exemplo: le "07:02" com confianca 0.95, mas "7:10" com confianca 0.70 (escrita borrada ou manuscrita)

### 2. Azure OpenAI / GPT (AI Filter)

- **Papel:** Revisor inteligente para campos duvidosos
- **Modelo:** `gpt-5.2-chat` (Azure OpenAI, Sweden Central)
- **So entra em acao** quando a confianca do OCR e **abaixo de 0.80** (threshold configuravel)
- Recebe o contexto completo: empresa, funcionario, horario contratual, dia da semana
- **Analisa se o valor faz sentido** e corrige quando necessario:
  - OCR leu "17:10" para entrada manha -> corrige para "07:10" (implausivel entrar as 17h de manha)
  - OCR leu "1:00" para saida tarde -> corrige para "16:00" (confusao com manuscrito)
  - OCR leu "07:05" para entrada manha -> confirma (plausivel)
- **Retorna:** valor corrigido + nova confianca + justificativa

### Fluxo Completo

```
Upload PDF
    |
    v
Azure Blob Storage (armazena o arquivo)
    |
    v
BullMQ Queue (fila assincrona)
    |
    v
OCR Worker:
    |
    +-- 1. Download do PDF do Blob Storage
    |
    +-- 2. Azure Document Intelligence (OCR)
    |       Extrai texto, tabelas, linhas com confianca
    |
    +-- 3. Card Parser
    |       Estrutura os dados: header (nome, empresa, CNPJ)
    |       + batidas (entrada/saida manha/tarde por dia)
    |
    +-- 4. Confidence Scorer
    |       Pontua cada batida, marca as que precisam de revisao
    |
    +-- 5. AI Filter (Azure OpenAI)
    |       So chamado para campos com confianca < 0.80
    |       Corrige valores implausíveis usando contexto
    |
    |       confianca >= 0.80  -->  aceita direto (sem custo IA)
    |       confianca <  0.80  -->  envia pro GPT revisar
    |
    +-- 6. Salva no banco (CartaoPonto + Batidas)
    |
    v
Revisao Humana (lado a lado: PDF original vs dados extraidos)
    |
    v
Exportacao (CSV/XLSX para folha de pagamento)
```

### Custos e Performance

- O AI Filter so e chamado nos casos duvidosos, economizando custo
- Exemplo real: de 31 batidas, apenas 7 tiveram confianca baixa (28 chamadas ao GPT, 4 campos cada)
- Latencia tipica: ~12s para Document Intelligence, ~250ms por chamada ao GPT
- Fallback gracioso: se o GPT falhar, o valor original do OCR e mantido

## Ambientes

| Ambiente | URL | Descrição |
|----------|-----|-----------|
| Local | http://localhost:3000 (API), :3001 (Web) | Docker Compose |
| Dev | TBD | Azure Container Apps (scale-to-zero) |
| Prod | TBD | Azure Container Apps |

## Documentação

- [PRD — Requisitos do Produto](docs/PRD.md)
- [SPECS — Especificação Técnica](docs/SPECS.md)
- [RULES — Regras de Desenvolvimento](docs/RULES.md)
- [SKILL — Instruções para Antigravity](docs/SKILL.md)
- [Guia de Arquitetura TotalUtiliti](docs/ARCHITECTURE-GUIDE.md)
- [Checklist de Testes](docs/TEST-CHECKLIST.md)

## Roadmap

| Fase | Escopo | Status |
|------|--------|--------|
| 1 | RH — Automação de Ponto e Folha | 🔨 Em desenvolvimento |
| 2 | Fiscal — Processamento robótico de notas via SPED | 📋 Planejado |
| 3 | Societário — CNDs e Guias via WhatsApp | 📋 Planejado |
| 4 | Controle Total Operacional | 📋 Planejado |

## Licença

Proprietary — TotalUtiliti Management Consultoria Ltda
