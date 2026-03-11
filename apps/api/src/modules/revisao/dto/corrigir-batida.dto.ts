import { z } from 'zod';

const hhmmRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const hhmmField = z
  .string()
  .regex(hhmmRegex, 'Formato deve ser HH:MM (00:00 a 23:59)')
  .optional();

export const corrigirBatidaSchema = z
  .object({
    entradaManhaCorrigida: hhmmField,
    saidaManhaCorrigida: hhmmField,
    entradaTardeCorrigida: hhmmField,
    saidaTardeCorrigida: hhmmField,
    entradaExtraCorrigida: hhmmField,
    saidaExtraCorrigida: hhmmField,
    observacao: z.string().max(500).optional(),
  })
  .refine(
    (data) => {
      const {
        entradaManhaCorrigida,
        saidaManhaCorrigida,
        entradaTardeCorrigida,
        saidaTardeCorrigida,
        entradaExtraCorrigida,
        saidaExtraCorrigida,
        observacao,
      } = data;

      return (
        entradaManhaCorrigida !== undefined ||
        saidaManhaCorrigida !== undefined ||
        entradaTardeCorrigida !== undefined ||
        saidaTardeCorrigida !== undefined ||
        entradaExtraCorrigida !== undefined ||
        saidaExtraCorrigida !== undefined ||
        observacao !== undefined
      );
    },
    { message: 'Pelo menos um campo deve ser informado' },
  );

export type CorrigirBatidaDto = z.infer<typeof corrigirBatidaSchema>;
