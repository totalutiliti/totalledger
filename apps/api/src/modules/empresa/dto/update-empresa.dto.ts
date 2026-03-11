import { z } from 'zod';

export const updateEmpresaSchema = z
  .object({
    razaoSocial: z.string().min(3).max(200).optional(),
    cnpj: z.string().regex(/^\d{14}$/, 'CNPJ deve ter 14 dígitos').optional(),
    nomeFantasia: z.string().max(200).optional(),
    contato: z.string().max(100).optional(),
    telefone: z.string().max(20).optional(),
    email: z.string().email().optional(),
    jornadaSegSex: z.string().optional(),
    intervaloAlmoco: z.string().optional(),
    jornadaSabado: z.string().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Pelo menos um campo deve ser informado para atualização',
  });

export type UpdateEmpresaDto = z.infer<typeof updateEmpresaSchema>;
