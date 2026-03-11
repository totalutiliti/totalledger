import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UsePipes,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TenantService } from './tenant.service';
import { CreateTenantDto, createTenantSchema } from './dto/create-tenant.dto';
import { UpdateTenantDto, updateTenantSchema } from './dto/update-tenant.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles, Role } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PaginationDto, paginationSchema } from '../../common/dto/pagination.dto';

@Controller('api/v1/tenants')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN)
  async findAll(@Query(new ZodValidationPipe(paginationSchema)) query: PaginationDto) {
    return this.tenantService.findAll(query);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN)
  async findOne(@Param('id') id: string) {
    return this.tenantService.findOne(id);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ZodValidationPipe(createTenantSchema))
  async create(@Body() dto: CreateTenantDto) {
    return this.tenantService.create(dto);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN)
  @UsePipes(new ZodValidationPipe(updateTenantSchema))
  async update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string) {
    return this.tenantService.remove(id);
  }
}
