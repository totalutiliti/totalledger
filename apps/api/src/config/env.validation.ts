import { z } from 'zod';
import { Logger } from '@nestjs/common';

const envSchema = z.object({
  // Required — app crashes on startup if missing
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  PEPPER_SECRET: z.string().min(8, 'PEPPER_SECRET must be at least 8 characters'),

  // Optional with defaults
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_VERSION: z.string().default('v1'),
  FRONTEND_URL: z.string().default('http://localhost:3001'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Azure Blob Storage (optional in dev — uses Azurite)
  AZURE_STORAGE_CONNECTION_STRING: z.string().default('UseDevelopmentStorage=true'),
  AZURE_STORAGE_CONTAINER_NAME: z.string().default('cartoes-ponto'),

  // Azure Document Intelligence (optional in dev)
  AZURE_DOC_INTEL_ENDPOINT: z.string().optional(),
  AZURE_DOC_INTEL_KEY: z.string().optional(),

  // Azure OpenAI (optional in dev)
  AZURE_OPENAI_ENDPOINT: z.string().optional(),
  AZURE_OPENAI_KEY: z.string().optional(),
  AZURE_OPENAI_DEPLOYMENT: z.string().default('gpt-4o-mini'),
  AZURE_OPENAI_API_VERSION: z.string().default('2024-10-01-preview'),

  // Azure OpenAI — OCR Pipeline models
  AZURE_OPENAI_MINI_DEPLOYMENT: z.string().default('gpt-5-mini'),
  AZURE_OPENAI_OCR_DEPLOYMENT: z.string().default('gpt-52-chat'),
  AZURE_OPENAI_OCR_API_VERSION: z.string().default('2025-04-01-preview'),

  // OCR Pipeline — concurrency controls
  OCR_MINI_CONCURRENCY: z.coerce.number().int().positive().default(8),
  OCR_GPT52_CONCURRENCY: z.coerce.number().int().positive().default(3),
  OCR_PAGE_CONCURRENCY: z.coerce.number().int().positive().default(8),

  // Pipeline version: 'v1' (Mini + 5.2 fallback) ou 'v2' (3x Mini + votacao + 5.2 fallback)
  PIPELINE_VERSION: z.enum(['v1', 'v2']).default('v1'),

  // Redis / BullMQ
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // Azure Application Insights (optional)
  APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().optional(),

  // Azure Key Vault (production only)
  AZURE_KEY_VAULT_URL: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validate(config: Record<string, unknown>): EnvConfig {
  const logger = new Logger('EnvValidation');

  const result = envSchema.safeParse(config);

  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    logger.error(`Environment validation failed:\n${errors}`);
    throw new Error(`Environment validation failed:\n${errors}`);
  }

  return result.data;
}
