# SKILL — SercofiRH: Instruções para Claude Code (Antigravity)

> **Este documento é a referência primária para o Antigravity ao trabalhar neste projeto.**  
> Leia INTEIRAMENTE antes de implementar qualquer tarefa.

---

## Contexto do Projeto

SercofiRH é um SaaS multi-tenant para automação de processamento de cartões de ponto usando OCR + IA. O cliente é a Sercofi Contabilidade. O sistema recebe PDFs de cartões de ponto (eletrônicos e manuscritos), extrai dados via Azure Document Intelligence, usa Azure OpenAI como filtro para campos ambíguos, e apresenta para revisão humana antes de exportar.

**Leia estes arquivos antes de codificar:**
- `docs/PRD.md` — Requisitos do produto
- `docs/SPECS.md` — Especificação técnica (schema, rotas, pipeline)
- `docs/RULES.md` — Regras obrigatórias de desenvolvimento
- `docs/ARCHITECTURE-GUIDE.md` — Guia de arquitetura TotalUtiliti (8 fases)
- `docs/TEST-CHECKLIST.md` — Checklist universal de testes

---

## Regras Absolutas (Nunca Violar)

1. **pnpm** — NUNCA use npm ou yarn. Sempre `pnpm install`, `pnpm add`, `pnpm run`.
2. **TypeScript strict** — NUNCA use `any`. Use `unknown` + type narrowing.
3. **tenantId do JWT** — NUNCA aceite tenantId do body/query/params. Sempre do token.
4. **Soft delete** — NUNCA `DELETE FROM`. Use campo `deletedAt`.
5. **Migrations imutáveis** — NUNCA edite uma migration existente. Crie uma nova.
6. **Sem console.log** — Use o logger do NestJS (`Logger`).
7. **Sem segredos no código** — Tudo via env vars / Key Vault.
8. **Validação com Zod** — Todo DTO validado na entrada.
9. **Formato de erro padrão** — Usar GlobalExceptionFilter. Nunca retornar erro ad-hoc.
10. **Testes obrigatórios** — Toda nova rota precisa de teste de integração.

---

## Padrões de Implementação

### Controller
```typescript
@Controller('api/v1/empresas')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@ApiBearerAuth()
export class EmpresaController {
  constructor(private readonly empresaService: EmpresaService) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.ANALISTA)
  async findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: PaginationDto,
  ) {
    return this.empresaService.findAll(tenantId, query);
  }

  @Post()
  @Roles(Role.ADMIN)
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @Body() dto: CreateEmpresaDto,
  ) {
    return this.empresaService.create(tenantId, userId, dto);
  }
}
```

### Service
```typescript
@Injectable()
export class EmpresaService {
  private readonly logger = new Logger(EmpresaService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, query: PaginationDto) {
    const { page = 1, limit = 20 } = query;
    const [data, total] = await Promise.all([
      this.prisma.empresa.findMany({
        where: { tenantId, deletedAt: null },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { razaoSocial: 'asc' },
      }),
      this.prisma.empresa.count({
        where: { tenantId, deletedAt: null },
      }),
    ]);

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
```

### DTO com Zod
```typescript
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
```

### Teste de Integração
```typescript
describe('EmpresaController (Integration)', () => {
  let app: INestApplication;
  let authHelper: AuthHelper;

  beforeAll(async () => {
    app = await createTestApp();
    authHelper = new AuthHelper(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/empresas', () => {
    it('deve criar empresa com ADMIN', async () => {
      const token = await authHelper.getToken(Role.ADMIN, 'tenant-1');
      const response = await request(app.getHttpServer())
        .post('/api/v1/empresas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          razaoSocial: 'Construlaje Ltda',
          cnpj: '46260666000180',
        })
        .expect(201);

      expect(response.body.data.razaoSocial).toBe('Construlaje Ltda');
      expect(response.body.data.tenantId).toBe('tenant-1');
    });

    it('deve rejeitar ANALISTA criando empresa', async () => {
      const token = await authHelper.getToken(Role.ANALISTA, 'tenant-1');
      await request(app.getHttpServer())
        .post('/api/v1/empresas')
        .set('Authorization', `Bearer ${token}`)
        .send({ razaoSocial: 'Test', cnpj: '12345678000199' })
        .expect(403);
    });

    it('deve isolar dados entre tenants', async () => {
      const tokenA = await authHelper.getToken(Role.ADMIN, 'tenant-1');
      const tokenB = await authHelper.getToken(Role.ADMIN, 'tenant-2');

      // Criar com tenant A
      await request(app.getHttpServer())
        .post('/api/v1/empresas')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ razaoSocial: 'Empresa do A', cnpj: '11111111000111' })
        .expect(201);

      // Listar com tenant B — não deve ver
      const response = await request(app.getHttpServer())
        .get('/api/v1/empresas')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      const cnpjs = response.body.data.map((e: any) => e.cnpj);
      expect(cnpjs).not.toContain('11111111000111');
    });
  });
});
```

---

## Pipeline OCR — Implementação

### Ordem de Implementação
1. **Upload Module** — Receber PDF, validar, salvar no Blob Storage, enfileirar
2. **OCR Queue/Worker** — BullMQ processor que consome jobs
3. **Document Intelligence Service** — Chamar Azure Doc Intel Layout API
4. **Card Parser Service** — Transformar output bruto em dados estruturados
5. **Confidence Scorer** — Pontuar confiança de cada campo
6. **AI Filter Service** — Chamar Azure OpenAI para campos ambíguos
7. **Revisão Module** — Tela lado a lado e edição

### BullMQ Worker
```typescript
@Processor('ocr-queue')
export class OcrProcessor {
  private readonly logger = new Logger(OcrProcessor.name);

  constructor(
    private readonly ocrPipeline: OcrPipelineService,
    private readonly uploadService: UploadService,
  ) {}

  @Process('process-pdf')
  async handleProcessPdf(job: Job<{ uploadId: string; tenantId: string }>) {
    const { uploadId, tenantId } = job.data;
    this.logger.log(`Processando upload ${uploadId}`, { tenantId, uploadId });

    try {
      await this.uploadService.updateStatus(uploadId, UploadStatus.PROCESSANDO);
      await this.ocrPipeline.processar(uploadId, tenantId);
      await this.uploadService.updateStatus(uploadId, UploadStatus.PROCESSADO);
    } catch (error) {
      this.logger.error(`Erro processando upload ${uploadId}`, error.stack, { tenantId, uploadId });
      await this.uploadService.updateStatus(uploadId, UploadStatus.ERRO, error.message);
      throw error; // BullMQ faz retry automático
    }
  }
}
```

### AI Cost Interceptor
```typescript
@Injectable()
export class AiCostInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AiCostInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const start = Date.now();
    return next.handle().pipe(
      tap(() => {
        // Log de custo é feito dentro do AiFilterService
      }),
    );
  }
}
```

---

## Fluxo de Trabalho com Antigravity

### Ao receber uma tarefa:
1. Leia o RULES.md e confirme que entende as restrições
2. Identifique qual módulo a tarefa afeta
3. Verifique se há testes existentes que podem quebrar
4. Implemente seguindo os padrões deste arquivo
5. Crie/atualize testes de integração
6. Rode `pnpm lint` e `pnpm test` antes de commitar
7. Commit com conventional commits: `feat(upload): add batch upload endpoint`

### Ao criar um novo módulo:
1. Criar pasta em `src/modules/{nome}/`
2. Criar: `{nome}.module.ts`, `{nome}.controller.ts`, `{nome}.service.ts`, `dto/`
3. Registrar no `app.module.ts`
4. Adicionar rotas no README de referência
5. Criar testes em `test/integration/{nome}.spec.ts`

### Ao modificar o schema Prisma:
1. Editar `prisma/schema.prisma`
2. `pnpm prisma migrate dev --name descricao-curta`
3. Verificar que a migration gerada está correta
4. NUNCA editar a migration depois de criada
5. Atualizar seeds se necessário
6. Rodar testes para confirmar que nada quebrou

---

## Checklist Pré-Commit

- [ ] `pnpm lint` — 0 errors
- [ ] `pnpm type-check` — 0 errors  
- [ ] `pnpm test` — todos passando
- [ ] Nenhum `any` no código
- [ ] Nenhum `console.log`
- [ ] Nenhum segredo hardcoded
- [ ] DTOs validados com Zod
- [ ] Testes de integração para novas rotas
- [ ] tenantId vindo do JWT (não do body)
- [ ] Conventional commit message
