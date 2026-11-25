import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { TasksService } from "../tasks/tasks.service";
import { monotonicNow } from "../common/monotonic-clock";
import { PREPARE_ORDER_TYPE } from "../work-item-types/system-types";
import { orderCode } from "./order-code";

/**
 * Tarefa «Preparar encomenda» (Fase 6c, docs/plano-fase-6-encomendas.md): quando uma encomenda que estava à espera fica
 * com todo o stock reservado, venha a entrada de onde vier (receção de uma compra, movimento manual, peça devolvida,
 * reserva libertada, «Reservar stock»).
 *
 * Corre DEPOIS de gravada a transação que reservou (as automações das tarefas correm como sempre e uma falha aqui não
 * desfaz a entrada de stock). Volta a ver se a encomenda está completa — duas entradas em simultâneo, de produtos
 * diferentes, não se veem uma à outra dentro das transações — e reclama `preparationTaskAt` antes de criar: uma só
 * tarefa por encomenda, mesmo com pedidos em simultâneo. Com o tipo «Preparar encomenda» desativado, não cria nada.
 */
@Injectable()
export class OrderPreparationService {
  private readonly logger = new Logger(OrderPreparationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModulesService,
    private readonly tasks: TasksService,
  ) {}

  /** `orderIds`: as encomendas servidas pela distribuição (as chaves do que `allocateWaiting` devolveu). */
  async afterAllocation(orderIds: Iterable<string>, actorId: string) {
    const ids = [...new Set(orderIds)];
    if (!ids.length || !this.modules.isEnabled("stock") || !this.modules.isEnabled("encomendas")) return;
    const type = await this.prisma.workItemType.findUnique({ where: { id: PREPARE_ORDER_TYPE }, select: { active: true } });
    if (!type?.active) return;
    for (const id of ids) {
      try {
        await this.prepare(id, actorId);
      } catch (err) {
        this.logger.error(`Falha ao criar a tarefa «Preparar encomenda» (${id}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async prepare(orderId: string, actorId: string) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: orderId },
      select: {
        number: true,
        status: true,
        preparationTaskAt: true,
        companyId: true,
        contactId: true,
        assignee: { select: { id: true, name: true, active: true } },
        createdBy: { select: { id: true, name: true, active: true } },
      },
    });
    if (!order || order.status !== "CONFIRMED" || order.preparationTaskAt) return;
    const waiting = await this.prisma.salesOrderLine.count({
      where: { orderId, product: { tracksStock: true }, reservedQuantity: { lt: this.prisma.salesOrderLine.fields.unshippedQuantity } },
    });
    if (waiting > 0) return;

    const claimed = await this.prisma.salesOrder.updateMany({ where: { id: orderId, status: "CONFIRMED", preparationTaskAt: null }, data: { preparationTaskAt: new Date() } });
    if (claimed.count === 0) return;

    const owner = [order.assignee, order.createdBy].find((u) => u?.active) ?? null;
    const code = orderCode(order.number);
    try {
      const task = await this.tasks.create(
        {
          title: `Preparar encomenda ${code}`,
          typeId: PREPARE_ORDER_TYPE,
          assigneeId: owner?.id ?? actorId,
          companyId: order.companyId ?? undefined,
          contactId: order.contactId ?? undefined,
          salesOrderId: orderId,
          dueDate: new Date().toISOString(),
        },
        actorId,
      );
      await this.prisma.timelineEvent.create({
        data: { entityType: "ORDER", entityId: orderId, type: "SYSTEM", description: `Tarefa criada: «${task.title}» para ${task.assignee.name}`, userId: actorId, createdAt: monotonicNow() },
      });
    } catch (err) {
      await this.prisma.salesOrder.update({ where: { id: orderId }, data: { preparationTaskAt: null } });
      throw err;
    }
  }
}
