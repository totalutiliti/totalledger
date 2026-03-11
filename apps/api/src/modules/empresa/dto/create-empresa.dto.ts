import { z } from 'zod';

export const createEmpresaSchema = z.object({
  razaoSocial: z.string().min(3).max(200),
  cnpj: z.string().regex(/^\d{14}$/, 'CNPJ deve ter 14 dígitos'),
  nomeFantasia: z.string().max(200).optional(),
  contato: z.string().max(100).optional(),
  telefone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  jornadaSegSex: z.string().optional(),
  intervaloAlmoco: z.string().optional(),
  jornadaSabado: z.string().optional(),
});

export type CreateEmpresaDto = z.infer<typeof createEmpresaSchema>;
