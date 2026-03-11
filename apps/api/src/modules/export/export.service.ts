import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { StatusRevisao } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { ExportRequestDto } from './dto/export-request.dto';

interface BatidaRow {
  funcionario: string;
  dia: number;
  diaSemana: string;
  entradaManha: string;
  saidaManha: string;
  entradaTarde: string;
  saidaTarde: string;
  entradaExtra: string;
  saidaExtra: string;
  horasNormais: string;
  horasExtras: string;
}

interface ExportResult {
  buffer: Buffer;
  fileName: string;
  totalRegistros: number;
}

const CSV_SEPARATOR = ';';
const CSV_HEADERS = [
  'Funcionario',
  'Dia',
  'DiaSemana',
  'EntradaManha',
  'SaidaManha',
  'EntradaTarde',
  'SaidaTarde',
  'EntradaExtra',
  'SaidaExtra',
  'HorasNormais',
  'HorasExtras',
];

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateCsv(
    tenantId: string,
    dto: ExportRequestDto,
  ): Promise<ExportResult> {
    const rows = await this.queryBatidas(tenantId, dto);

    if (rows.length === 0) {
      throw new NotFoundException(
        'Nenhum registro aprovado encontrado para os filtros informados',
      );
    }

    const lines: string[] = [CSV_HEADERS.join(CSV_SEPARATOR)];

    for (const row of rows) {
      const line = [
        this.escapeCsvField(row.funcionario),
        String(row.dia),
        this.escapeCsvField(row.diaSemana),
        row.entradaManha,
        row.saidaManha,
        row.entradaTarde,
        row.saidaTarde,
        row.entradaExtra,
        row.saidaExtra,
        row.horasNormais,
        row.horasExtras,
      ].join(CSV_SEPARATOR);

      lines.push(line);
    }

    const csvContent = '\uFEFF' + lines.join('\r\n');
    const buffer = Buffer.from(csvContent, 'utf-8');

    const empresa = await this.getEmpresaNome(tenantId, dto.empresaId);
    const fileName = `export_${this.sanitizeFileName(empresa)}_${dto.mesReferencia}.csv`;

    this.logger.log('CSV export generated', {
      tenantId,
      empresaId: dto.empresaId,
      mesReferencia: dto.mesReferencia,
      totalRegistros: rows.length,
    });

    return { buffer, fileName, totalRegistros: rows.length };
  }

  async generateXlsx(
    tenantId: string,
    dto: ExportRequestDto,
  ): Promise<ExportResult> {
    const rows = await this.queryBatidas(tenantId, dto);

    if (rows.length === 0) {
      throw new NotFoundException(
        'Nenhum registro aprovado encontrado para os filtros informados',
      );
    }

    const empresa = await this.getEmpresaNome(tenantId, dto.empresaId);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SercofiRH';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Cartoes de Ponto');

    sheet.columns = [
      { header: 'Funcionario', key: 'funcionario', width: 30 },
      { header: 'Dia', key: 'dia', width: 6 },
      { header: 'Dia Semana', key: 'diaSemana', width: 12 },
      { header: 'Entrada Manha', key: 'entradaManha', width: 14 },
      { header: 'Saida Manha', key: 'saidaManha', width: 14 },
      { header: 'Entrada Tarde', key: 'entradaTarde', width: 14 },
      { header: 'Saida Tarde', key: 'saidaTarde', width: 14 },
      { header: 'Entrada Extra', key: 'entradaExtra', width: 14 },
      { header: 'Saida Extra', key: 'saidaExtra', width: 14 },
      { header: 'Horas Normais', key: 'horasNormais', width: 14 },
      { header: 'Horas Extras', key: 'horasExtras', width: 14 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'center' };

    for (const row of rows) {
      sheet.addRow(row);
    }

    const xlsxBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const fileName = `export_${this.sanitizeFileName(empresa)}_${dto.mesReferencia}.xlsx`;

    this.logger.log('XLSX export generated', {
      tenantId,
      empresaId: dto.empresaId,
      mesReferencia: dto.mesReferencia,
      totalRegistros: rows.length,
    });

    return { buffer: Buffer.from(xlsxBuffer), fileName, totalRegistros: rows.length };
  }

  private async queryBatidas(
    tenantId: string,
    dto: ExportRequestDto,
  ): Promise<BatidaRow[]> {
    const empresa = await this.prisma.empresa.findFirst({
      where: { id: dto.empresaId, tenantId, deletedAt: null },
    });

    if (!empresa) {
      throw new BadRequestException(
        `Empresa ${dto.empresaId} nao encontrada neste tenant`,
      );
    }

    const cartoes = await this.prisma.cartaoPonto.findMany({
      where: {
        tenantId,
        upload: {
          empresaId: dto.empresaId,
          mesReferencia: dto.mesReferencia,
          deletedAt: null,
        },
        statusRevisao: {
          in: [StatusRevisao.APROVADO],
        },
      },
      include: {
        batidas: {
          orderBy: { dia: 'asc' },
        },
        funcionario: {
          select: { nome: true },
        },
      },
      orderBy: { nomeExtraido: 'asc' },
    });

    const rows: BatidaRow[] = [];

    for (const cartao of cartoes) {
      const funcionarioNome =
        cartao.funcionario?.nome ?? cartao.nomeExtraido ?? 'Desconhecido';

      for (const batida of cartao.batidas) {
        rows.push({
          funcionario: funcionarioNome,
          dia: batida.dia,
          diaSemana: batida.diaSemana ?? '',
          entradaManha: batida.entradaManhaCorrigida ?? batida.entradaManha ?? '',
          saidaManha: batida.saidaManhaCorrigida ?? batida.saidaManha ?? '',
          entradaTarde: batida.entradaTardeCorrigida ?? batida.entradaTarde ?? '',
          saidaTarde: batida.saidaTardeCorrigida ?? batida.saidaTarde ?? '',
          entradaExtra: batida.entradaExtraCorrigida ?? batida.entradaExtra ?? '',
          saidaExtra: batida.saidaExtraCorrigida ?? batida.saidaExtra ?? '',
          horasNormais: batida.horasNormais != null ? String(batida.horasNormais) : '',
          horasExtras: batida.horasExtras != null ? String(batida.horasExtras) : '',
        });
      }
    }

    return rows;
  }

  private async getEmpresaNome(
    tenantId: string,
    empresaId: string,
  ): Promise<string> {
    const empresa = await this.prisma.empresa.findFirst({
      where: { id: empresaId, tenantId, deletedAt: null },
      select: { nomeFantasia: true, razaoSocial: true },
    });

    return empresa?.nomeFantasia ?? empresa?.razaoSocial ?? 'empresa';
  }

  private sanitizeFileName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .substring(0, 50);
  }

  private escapeCsvField(value: string): string {
    if (
      value.includes(CSV_SEPARATOR) ||
      value.includes('"') ||
      value.includes('\n')
    ) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
