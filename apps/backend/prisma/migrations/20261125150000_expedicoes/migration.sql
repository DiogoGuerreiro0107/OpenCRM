-- Fase 6d (docs/plano-fase-6-encomendas.md): transportadoras e expedições (envio total ou parcial) das encomendas.

-- AlterTable
ALTER TABLE "SalesOrderLine" ADD COLUMN     "shippedQuantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "unshippedQuantity" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Carrier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "trackingUrlTemplate" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Carrier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "carrierId" TEXT,
    "trackingCode" TEXT,
    "packages" INTEGER,
    "weightKg" DECIMAL(10,2),
    "cost" DECIMAL(12,2),
    "notes" TEXT,
    "shippedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentLine" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "ShipmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Carrier_nameKey_key" ON "Carrier"("nameKey");

-- CreateIndex
CREATE INDEX "Shipment_orderId_shippedAt_idx" ON "Shipment"("orderId", "shippedAt");

-- CreateIndex
CREATE INDEX "Shipment_carrierId_idx" ON "Shipment"("carrierId");

-- CreateIndex
CREATE INDEX "ShipmentLine_orderLineId_idx" ON "ShipmentLine"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentLine_shipmentId_orderLineId_key" ON "ShipmentLine"("shipmentId", "orderLineId");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_carrierId_fkey" FOREIGN KEY ("carrierId") REFERENCES "Carrier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "SalesOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Limites (Fase 6d).
ALTER TABLE "Carrier" ADD CONSTRAINT "Carrier_link"
  CHECK ("trackingUrlTemplate" IS NULL OR position('{codigo}' IN "trackingUrlTemplate") > 0);
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_limites"
  CHECK (("packages" IS NULL OR "packages" >= 1) AND ("weightKg" IS NULL OR "weightKg" >= 0) AND ("cost" IS NULL OR "cost" >= 0));
ALTER TABLE "ShipmentLine" ADD CONSTRAINT "ShipmentLine_quantidade" CHECK ("quantity" > 0);

-- Por enviar = quantidade − enviado, sempre (nunca se escreve à mão).
CREATE FUNCTION "sales_order_line_por_enviar"() RETURNS trigger AS $$
BEGIN
  NEW."unshippedQuantity" := NEW."quantity" - NEW."shippedQuantity";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SalesOrderLine_por_enviar"
  BEFORE INSERT OR UPDATE ON "SalesOrderLine"
  FOR EACH ROW EXECUTE FUNCTION "sales_order_line_por_enviar"();

-- As encomendas já enviadas ou entregues saíram por inteiro; as outras não enviaram nada. Recalcula o «por enviar» de
-- todas as linhas (pelo trigger). Não mexe nas reservas.
UPDATE "SalesOrderLine" l
  SET "shippedQuantity" = CASE WHEN o."status" IN ('SHIPPED', 'DELIVERED') THEN l."quantity" ELSE 0 END
  FROM "SalesOrder" o WHERE o."id" = l."orderId";

-- O enviado vai de 0 à quantidade; a reserva, de 0 ao que falta enviar (antes: até à quantidade).
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_envio"
  CHECK ("shippedQuantity" >= 0 AND "shippedQuantity" <= "quantity");
ALTER TABLE "SalesOrderLine" DROP CONSTRAINT "SalesOrderLine_reserva";
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_reserva"
  CHECK ("reservedQuantity" >= 0 AND "reservedQuantity" <= "quantity" - "shippedQuantity" AND ("reservedQuantity" = 0 OR "productId" IS NOT NULL));

-- Uma expedição por cada encomenda já enviada, com as linhas todas: o enviado de cada linha é sempre a soma das
-- expedições.
INSERT INTO "Shipment" ("id", "orderId", "notes", "shippedAt", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, o."id", 'Registada na migração (enviada antes das expedições)',
         COALESCE(o."shippedAt", o."updatedAt"), COALESCE(o."shippedAt", o."updatedAt"), CURRENT_TIMESTAMP
  FROM "SalesOrder" o WHERE o."status" IN ('SHIPPED', 'DELIVERED');

INSERT INTO "ShipmentLine" ("id", "shipmentId", "orderLineId", "quantity")
  SELECT gen_random_uuid()::text, s."id", l."id", l."quantity"
  FROM "Shipment" s JOIN "SalesOrderLine" l ON l."orderId" = s."orderId";
