-- CreateEnum
CREATE TYPE "Plano" AS ENUM ('STARTER', 'PROFESSIONAL', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'ANALISTA');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('AGUARDANDO', 'PROCESSANDO', 'PROCESSADO', 'ERRO', 'VALIDADO', 'EXPORTADO');

-- CreateEnum
CREATE TYPE "TipoCartao" AS ENUM ('ELETRONICO', 'MANUSCRITO', 'HIBRIDO', 'DESCONHECIDO');

-- CreateEnum
CREATE TYPE "StatusRevisao" AS ENUM ('PENDENTE', 'EM_REVISAO', 'APROVADO', 'REJEITADO');

-- CreateEnum
CREATE TYPE "AcaoRevisao" AS ENUM ('CORRECAO', 'APROVACAO', 'REJEICAO', 'OBSERVACAO');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "plano" "Plano" NOT NULL DEFAULT 'STARTER',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "suspenso" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'ANALISTA',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empresas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "nomeFantasia" TEXT,
    "contato" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "jornadaSegSex" TEXT,
    "intervaloAlmoco" TEXT,
    "jornadaSabado" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funcionarios" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cargo" TEXT,
    "cpf" TEXT,
    "matricula" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funcionarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mesReferencia" TEXT NOT NULL,
    "nomeArquivo" TEXT NOT NULL,
    "blobUrl" TEXT NOT NULL,
    "blobPath" TEXT NOT NULL,
    "tamanhoBytes" INTEGER NOT NULL,
    "totalPaginas" INTEGER,
    "status" "UploadStatus" NOT NULL DEFAULT 'AGUARDANDO',
    "erroMensagem" TEXT,
    "processadoEm" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cartoes_ponto" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "funcionarioId" TEXT,
    "paginaPdf" INTEGER NOT NULL,
    "nomeExtraido" TEXT,
    "cargoExtraido" TEXT,
    "mesExtraido" TEXT,
    "empresaExtraida" TEXT,
    "cnpjExtraido" TEXT,
    "horarioContratual" TEXT,
    "tipoCartao" "TipoCartao" NOT NULL DEFAULT 'DESCONHECIDO',
    "statusRevisao" "StatusRevisao" NOT NULL DEFAULT 'PENDENTE',
    "confiancaGeral" DOUBLE PRECISION,
    "ocrRawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cartoes_ponto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batidas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cartaoPontoId" TEXT NOT NULL,
    "dia" INTEGER NOT NULL,
    "diaSemana" TEXT,
    "entradaManha" TEXT,
    "saidaManha" TEXT,
    "entradaTarde" TEXT,
    "saidaTarde" TEXT,
    "entradaExtra" TEXT,
    "saidaExtra" TEXT,
    "entradaManhaCorrigida" TEXT,
    "saidaManhaCorrigida" TEXT,
    "entradaTardeCorrigida" TEXT,
    "saidaTardeCorrigida" TEXT,
    "entradaExtraCorrigida" TEXT,
    "saidaExtraCorrigida" TEXT,
    "horasNormais" DOUBLE PRECISION,
    "horasExtras" DOUBLE PRECISION,
    "confianca" JSONB,
    "isManuscrito" BOOLEAN NOT NULL DEFAULT false,
    "isInconsistente" BOOLEAN NOT NULL DEFAULT false,
    "isFaltaDia" BOOLEAN NOT NULL DEFAULT false,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batidas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revisoes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cartaoPontoId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acao" "AcaoRevisao" NOT NULL,
    "campo" TEXT,
    "valorAnterior" TEXT,
    "valorNovo" TEXT,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revisoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "dados" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_cnpj_key" ON "tenants"("cnpj");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE INDEX "empresas_tenantId_idx" ON "empresas"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "empresas_tenantId_cnpj_key" ON "empresas"("tenantId", "cnpj");

-- CreateIndex
CREATE INDEX "funcionarios_tenantId_idx" ON "funcionarios"("tenantId");

-- CreateIndex
CREATE INDEX "funcionarios_empresaId_idx" ON "funcionarios"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "funcionarios_tenantId_empresaId_cpf_key" ON "funcionarios"("tenantId", "empresaId", "cpf");

-- CreateIndex
CREATE INDEX "uploads_tenantId_idx" ON "uploads"("tenantId");

-- CreateIndex
CREATE INDEX "uploads_tenantId_status_idx" ON "uploads"("tenantId", "status");

-- CreateIndex
CREATE INDEX "uploads_empresaId_mesReferencia_idx" ON "uploads"("empresaId", "mesReferencia");

-- CreateIndex
CREATE INDEX "cartoes_ponto_tenantId_idx" ON "cartoes_ponto"("tenantId");

-- CreateIndex
CREATE INDEX "cartoes_ponto_uploadId_idx" ON "cartoes_ponto"("uploadId");

-- CreateIndex
CREATE INDEX "cartoes_ponto_tenantId_statusRevisao_idx" ON "cartoes_ponto"("tenantId", "statusRevisao");

-- CreateIndex
CREATE INDEX "batidas_tenantId_idx" ON "batidas"("tenantId");

-- CreateIndex
CREATE INDEX "batidas_cartaoPontoId_idx" ON "batidas"("cartaoPontoId");

-- CreateIndex
CREATE UNIQUE INDEX "batidas_cartaoPontoId_dia_key" ON "batidas"("cartaoPontoId", "dia");

-- CreateIndex
CREATE INDEX "revisoes_tenantId_idx" ON "revisoes"("tenantId");

-- CreateIndex
CREATE INDEX "revisoes_cartaoPontoId_idx" ON "revisoes"("cartaoPontoId");

-- CreateIndex
CREATE INDEX "feature_flags_tenantId_idx" ON "feature_flags"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_tenantId_feature_key" ON "feature_flags"("tenantId", "feature");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_idx" ON "audit_logs"("tenantId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_entidade_entidadeId_idx" ON "audit_logs"("tenantId", "entidade", "entidadeId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empresas" ADD CONSTRAINT "empresas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funcionarios" ADD CONSTRAINT "funcionarios_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cartoes_ponto" ADD CONSTRAINT "cartoes_ponto_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cartoes_ponto" ADD CONSTRAINT "cartoes_ponto_funcionarioId_fkey" FOREIGN KEY ("funcionarioId") REFERENCES "funcionarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batidas" ADD CONSTRAINT "batidas_cartaoPontoId_fkey" FOREIGN KEY ("cartaoPontoId") REFERENCES "cartoes_ponto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisoes" ADD CONSTRAINT "revisoes_cartaoPontoId_fkey" FOREIGN KEY ("cartaoPontoId") REFERENCES "cartoes_ponto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisoes" ADD CONSTRAINT "revisoes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
