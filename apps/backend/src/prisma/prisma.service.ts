import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Colunas internas de pesquisa (mantidas por triggers) nunca saem: nem nas listas, nem em includes de outras
    // entidades. Quem precisar delas pede-as explicitamente com `omit: { searchText: false }`.
    super({ omit: { company: { searchText: true }, contact: { searchText: true } } });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
