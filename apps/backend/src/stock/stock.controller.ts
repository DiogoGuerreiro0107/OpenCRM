import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { WriteArea } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ModuleGuard } from "../modules/module.guard";
import { RequireModule } from "../modules/require-module.decorator";
import { StockService } from "./stock.service";
import { CreateStockMovementDto, QueryStockMovementsDto } from "./dto/stock.dto";

/**
 * Stock (módulo `stock`, Fase 5b). Ver é para todos; lançar movimentos usa a área «Movimentos de stock». Os
 * movimentos são o próprio registo (quem, quando, motivo) e não se alteram.
 */
@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@RequireModule("stock")
@WriteArea("stock")
@Controller("stock")
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get("movements")
  findPage(@Query() query: QueryStockMovementsDto) {
    return this.stock.findPage(query);
  }

  @Get("summary")
  summary() {
    return this.stock.summary();
  }

  @Post("movements")
  create(@Body() dto: CreateStockMovementDto, @CurrentUser() user: { userId: string }) {
    return this.stock.create(dto, user.userId);
  }
}
