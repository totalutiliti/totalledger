import { z } from 'zod';

export const updateTenantSchema = z
  .object({
    nome: z.string().min(3).max(200).optional(),
    plano: z.enum(['STARTER', 'PROFESSIONAL', 'ENTERPRISE']).optional(),
    ativo: z.boolean().optional(),
    suspenso: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Pelo menos um campo deve ser fornecido',
  });

export type UpdateTenantDto = z.infer<typeof updateTenantSchema>;
