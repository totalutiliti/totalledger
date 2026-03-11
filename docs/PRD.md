# PRD — SercofiRH: Automação Inteligente de Ponto e Folha

## 1. Visão Geral

**Produto:** SercofiRH  
**Cliente:** Sercofi Contabilidade (https://www.sercofi.com.br/)  
**Desenvolvido por:** TotalUtiliti Management Consultoria Ltda (CNPJ 55.249.293/0001-37)  
**Versão:** 1.0 — MVP  
**Data:** Março 2026  

### 1.1 Problema

A Sercofi é uma contabilidade que recebe mensalmente **cartões de ponto** de dezenas de empresas-clientes. Esses cartões chegam em formatos variados:

- **Relógios eletrônicos** (ex: HENRY) — impressos com fonte monoespaçada
- **Cartões manuais/manuscritos** — preenchidos à mão pelos funcionários
- **Formatos híbridos** — relógio eletrônico com correções manuscritas

Hoje o processamento é **100% manual**: analistas da Sercofi abrem cada PDF, leem os horários e digitam no sistema de folha de pagamento. Isso gera:

- **Erros de digitação** que resultam em cálculos errados de horas extras e descontos
- **Tempo excessivo** — cada cartão leva minutos para processar manualmente
- **Retrabalho** quando erros são detectados depois
- **Risco trabalhista** — erros em ponto podem gerar ações judiciais

### 1.2 Solução

Um sistema SaaS multi-tenant onde:

1. A Sercofi faz **upload de PDFs** de cartões de ponto (individuais ou em lote)
2. **Azure Document Intelligence** extrai os dados estruturados via OCR
3. **Azure OpenAI** atua como "Filtro IA" para interpretar campos manuscritos, corrigir ambiguidades e validar consistência
4. O sistema apresenta os dados extraídos para **revisão humana** antes de consolidar
5. Dados validados são exportados para o sistema de folha de pagamento

### 1.3 Roadmap de Fases

| Fase | Escopo | Status |
|------|--------|--------|
| **Fase 1** | RH — Automação de Ponto e Folha + Treinamento | **MVP** |
| **Fase 2** | Fiscal — Processamento robótico de notas via SPED (5.000 notas) | Preparar arquitetura |
| **Fase 3** | Societário e Impostos — Emissão e envio automático de CNDs e Guias via WhatsApp | Preparar arquitetura |
| **Fase 4** | Controle Total Operacional — Ambiente de zero multas ou esquecimentos | Preparar arquitetura |

> **Escopo do MVP (Fase 1):** todo o pipeline de OCR + IA para cartões de ponto. As fases 2-4 devem ser consideradas na arquitetura (módulos plugáveis, domínios separados), mas não implementadas.

---

## 2. Usuários e Personas

### 2.1 Analista de RH (Sercofi)

- **Quem:** Funcionário da Sercofi que processa folha de pagamento
- **Dor:** Gasta horas digitando dados de cartões de ponto manualmente
- **Objetivo:** Fazer upload de PDFs e obter dados extraídos para revisão rápida
- **Volume:** ~50-200 cartões/mês por empresa-cliente

### 2.2 Gestor/Supervisor (Sercofi)

- **Quem:** Responsável pela equipe de analistas
- **Dor:** Não tem visibilidade de produtividade e erros
- **Objetivo:** Dashboard de progresso, métricas de processamento, auditoria

### 2.3 Administrador do Sistema

- **Quem:** Responsável técnico da Sercofi ou TotalUtiliti
- **Dor:** Gestão de acessos e configurações
- **Objetivo:** Gerenciar tenants, usuários, configurações de OCR

---

## 3. Requisitos Funcionais

### 3.1 Módulo de Upload e Ingestão

| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-001 | Upload individual de PDF de cartão de ponto | CRÍTICO |
| RF-002 | Upload em lote (múltiplos PDFs de uma vez) | CRÍTICO |
| RF-003 | Validação de arquivo (tipo PDF, tamanho máximo 20MB) | CRÍTICO |
| RF-004 | Armazenamento dos PDFs originais em Azure Blob Storage | CRÍTICO |
| RF-005 | Associação do upload à empresa-cliente (tenant) e mês de referência | CRÍTICO |
| RF-006 | Status de processamento visível (Aguardando, Processando, Processado, Erro, Validado) | CRÍTICO |
| RF-007 | Reprocessamento manual de PDFs com erro | IMPORTANTE |

### 3.2 Módulo de OCR + IA (Pipeline de Extração)

| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-010 | Extração via Azure Document Intelligence (Layout/Custom Model) | CRÍTICO |
| RF-011 | Identificação automática do tipo de cartão (eletrônico vs manuscrito vs híbrido) | CRÍTICO |
| RF-012 | Extração do cabeçalho: empresa, CNPJ, funcionário, cargo, mês, horário contratual | CRÍTICO |
| RF-013 | Extração da tabela de batidas: dia, entrada manhã, saída manhã, entrada tarde, saída tarde, extras | CRÍTICO |
| RF-014 | Filtro IA (Azure OpenAI) para interpretar campos manuscritos ambíguos | CRÍTICO |
| RF-015 | Nível de confiança por campo extraído (alto/médio/baixo) | IMPORTANTE |
| RF-016 | Flag automática para campos que precisam revisão humana (confiança < threshold) | IMPORTANTE |
| RF-017 | Cálculo automático de horas trabalhadas por dia | IMPORTANTE |
| RF-018 | Detecção de inconsistências (ex: saída antes da entrada, gaps impossíveis) | IMPORTANTE |
| RF-019 | Processamento assíncrono via fila (não bloquear a requisição) | CRÍTICO |

### 3.3 Módulo de Revisão e Validação

| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-020 | Tela de revisão lado a lado: PDF original + dados extraídos | CRÍTICO |
| RF-021 | Edição manual de campos extraídos pelo analista | CRÍTICO |
| RF-022 | Destaque visual de campos com baixa confiança | IMPORTANTE |
| RF-023 | Aprovação/rejeição por funcionário | CRÍTICO |
| RF-024 | Histórico de alterações (quem editou o quê) | IMPORTANTE |
| RF-025 | Workflow de aprovação em duas etapas (analista → supervisor) | MATURIDADE |

### 3.4 Módulo de Exportação

| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-030 | Exportação dos dados validados em formato CSV | CRÍTICO |
| RF-031 | Exportação em formato XLSX com formatação | IMPORTANTE |
| RF-032 | Exportação em formato compatível com sistemas de folha (layout configurável) | MATURIDADE |
| RF-033 | Relatório de resumo mensal por empresa-cliente | IMPORTANTE |

### 3.5 Módulo de Dashboard e Relatórios

| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-040 | Dashboard com volume processado, pendente, com erro | CRÍTICO |
| RF-041 | Métricas de taxa de acerto do OCR por tipo de cartão | IMPORTANTE |
| RF-042 | Tempo médio de processamento por cartão | IMPORTANTE |
| RF-043 | Relatório de produtividade por analista | MATURIDADE |

### 3.6 Gestão de Empresas-Cliente e Multi-Tenancy

| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-050 | Cadastro de empresas-cliente da Sercofi (CNPJ, razão social, contato) | CRÍTICO |
| RF-051 | Configuração de horário padrão por empresa (jornada, intervalo, sábado) | IMPORTANTE |
| RF-052 | Isolamento de dados por empresa-cliente (RLS) | CRÍTICO |
| RF-053 | Multi-tenancy: Sercofi como tenant principal, preparar para outras contabilidades no futuro | IMPORTANTE |

### 3.7 Preparação para Fases Futuras (Arquitetura Plugável)

| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-060 | Domínio `fiscal` criado como módulo vazio com estrutura básica | MATURIDADE |
| RF-061 | Domínio `societario` criado como módulo vazio com estrutura básica | MATURIDADE |
| RF-062 | Sistema de módulos/features habilitáveis por tenant | MATURIDADE |
| RF-063 | Eventos de domínio para comunicação entre módulos futuros | IMPORTANTE |

---

## 4. Requisitos Não-Funcionais

| ID | Requisito | Meta |
|----|-----------|------|
| RNF-001 | Tempo de processamento por PDF (OCR + IA) | < 30 segundos |
| RNF-002 | Taxa de acerto do OCR em cartões eletrônicos | > 95% |
| RNF-003 | Taxa de acerto do OCR em cartões manuscritos | > 80% (com flag de revisão) |
| RNF-004 | Disponibilidade | 99.5% em horário comercial |
| RNF-005 | Latência de API (endpoints CRUD) | p95 < 500ms |
| RNF-006 | Upload máximo por arquivo | 20MB |
| RNF-007 | Upload em lote máximo | 50 arquivos simultâneos |
| RNF-008 | Retenção de PDFs originais | 5 anos (requisito trabalhista) |
| RNF-009 | Backup automático com restore testado | RPO < 24h, RTO < 4h |
| RNF-010 | LGPD compliance (dados de funcionários são PII) | Obrigatório |

---

## 5. Fora de Escopo (MVP)

- Integração direta com sistemas de folha (eSocial, Domínio, etc.)
- App mobile
- Processamento de notas fiscais (Fase 2)
- Emissão de CNDs e Guias (Fase 3)
- WhatsApp Business API (Fase 3)
- Machine Learning para melhoria contínua do OCR (pós-MVP)

---

## 6. Métricas de Sucesso

| Métrica | Baseline (manual) | Meta (com sistema) |
|---------|-------------------|-------------------|
| Tempo por cartão processado | ~5 min | < 1 min (incluindo revisão) |
| Taxa de erro em digitação | ~5-8% | < 2% (após revisão) |
| Cartões processados/dia/analista | ~60 | ~300+ |
| Retrabalho por erro | ~15% dos cartões | < 3% |

---

## 7. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| OCR com baixa acurácia em manuscritos | Alto | Filtro IA + revisão humana obrigatória + threshold de confiança |
| Variação extrema de formatos de cartão | Médio | Custom model no Document Intelligence treinado com exemplos reais |
| Custo de Azure OpenAI por volume | Médio | Usar IA apenas para campos ambíguos, não para tudo; cache de padrões |
| Resistência dos analistas à mudança | Médio | Treinamento incluso na Fase 1; UX focada em facilidade |
| Dados sensíveis de funcionários (LGPD) | Alto | Criptografia, RLS, auditoria, retenção definida |
