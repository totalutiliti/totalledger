-- CreateTable
CREATE TABLE "tenant_ocr_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "timeFieldRanges" JSONB,
    "minLunchBreakMinutes" INTEGER NOT NULL DEFAULT 60,
    "maxWorkdayMinutes" INTEGER NOT NULL DEFAULT 600,
    "reviewThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.80,
    "gptSkipThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.90,
    "outlierZWarning" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "outlierZError" DOUBLE PRECISION NOT NULL DEFAULT 3.0,
    "outlierMinDays" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_ocr_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_ocr_configs_tenantId_key" ON "tenant_ocr_configs"("tenantId");

-- CreateIndex
CREATE INDEX "tenant_ocr_configs_tenantId_idx" ON "tenant_ocr_configs"("tenantId");
