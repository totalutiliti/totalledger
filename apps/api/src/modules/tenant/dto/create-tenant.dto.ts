import { z } from 'zod';

export const createTenantSchema = z.object({
  nome: z.string().min(3).max(200),
  cnpj: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .pipe(z.string().regex(/^\d{14}$/, 'CNPJ deve ter 14 dígitos')),
  plano: z.enum(['STARTER', 'PROFESSIONAL', 'ENTERPRISE']).default('STARTER'),
});

export type CreateTenantDto = z.infer<typeof createTenantSchema>;
