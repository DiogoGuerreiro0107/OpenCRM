import { UnprocessableEntityException } from "@nestjs/common";
import { Company, Contact, Prisma } from "@prisma/client";
import { normalizeTaxId, TAX_ID_SQL } from "../leads/lead-conversion";

/**
 * Encomenda vinda de fora (Fase 6e, API pública): o cliente por NIF/email e as linhas por referência, resolvidos
 * dentro da mesma transação que cria a encomenda (tudo ou nada). docs/plano-fase-6-encomendas.md, «Pacote 6e».
 */

type Tx = Prisma.TransactionClient;

export interface OrderIntakeCustomer {
  taxId?: string;
  email?: string;
  companyName?: string;
  name?: string;
  phone?: string;
}

export interface OrderIntakeLine {
  /** Referência de um produto do catálogo; sem ela, a linha é livre (descrição, preço e IVA obrigatórios). */
  sku?: string;
  description?: string;
  quantity: number;
  unitPrice?: number;
  discountPct?: number;
  vatRate?: number;
}

export interface OrderIntake {
  /** Id da encomenda, gerado antes (a ligação ao id externo é criada primeiro, na mesma transação). */
  id: string;
  customer: OrderIntakeCustomer;
  lines: OrderIntakeLine[];
  customerReference?: string;
  deliveryAddress?: string;
  notes?: string;
  confirm: boolean;
  /** Quem a enviou, para a timeline: «a API (chave «Loja online»)». */
  origin: string;
  externalLink?: { provider: string; externalId: string };
}

/** Pedido bem formado que não se pode cumprir (referência desconhecida, cliente que não se encontra nem cria). */
export class OrderIntakeError extends UnprocessableEntityException {
  constructor(
    message: string,
    public readonly details: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** O id externo já está ligado a outra encomenda desta origem. */
export class DuplicateExternalIdError extends Error {}

/** Cria a ligação ao id externo. Primeiro passo da transação: um pedido simultâneo com o mesmo id espera aqui. */
export async function linkExternalId(tx: Tx, link: OrderIntake["externalLink"], orderId: string) {
  if (!link) return;
  try {
    await tx.externalLink.create({ data: { provider: link.provider, entityType: "order", entityId: orderId, externalId: link.externalId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new DuplicateExternalIdError();
    throw err;
  }
}

/** Serializa, até ao fim da transação, quem cria clientes com o mesmo NIF ou email (não nascem dois iguais). */
async function lockKey(tx: Tx, key: string) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

const quote = (s: string) => `"${s}"`;

export interface ResolvedCustomer {
  company: Company | null;
  contact: Contact | null;
  /** Para a timeline da encomenda. */
  notes: string[];
  /** Registos criados agora (para a timeline de cada um, depois de a encomenda ter número). */
  created: { company: boolean; contact: boolean };
}

/**
 * Cliente da encomenda:
 *  - empresa: a que tiver o mesmo NIF (normalizado como na conversão de leads); senão, sem NIF mas com o nome da
 *    empresa, a do contacto encontrado pelo email (se tiver); senão, com o nome da empresa, cria-se (com o NIF);
 *  - contacto: o que tiver o mesmo email (sem distinguir maiúsculas); senão, com nome ou email, cria-se. Um contacto
 *    encontrado que é de OUTRA empresa não entra na encomenda; um sem empresa ganha a da encomenda.
 */
export async function resolveCustomer(tx: Tx, input: OrderIntakeCustomer): Promise<ResolvedCustomer> {
  const taxIdKey = normalizeTaxId(input.taxId);
  const taxId = input.taxId?.trim() || null;
  const email = input.email?.trim() || null;
  const companyName = input.companyName?.trim() || null;
  const name = input.name?.trim() || null;
  const phone = input.phone?.trim() || null;
  if (!taxIdKey && !email && !companyName && !name) {
    throw new OrderIntakeError("Indica o cliente: NIF, email ou nome", { field: "customer" });
  }
  // Sempre pela mesma ordem (NIF, depois email): dois pedidos nunca esperam um pelo outro em círculo.
  if (taxIdKey) await lockKey(tx, `opencrm:customer-tax:${taxIdKey}`);
  if (email) await lockKey(tx, `opencrm:customer-email:${email.toLowerCase()}`);

  const notes: string[] = [];
  const created = { company: false, contact: false };
  let companyHow = "";

  let company: Company | null = null;
  if (taxIdKey) {
    const [match] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Company" WHERE ${Prisma.raw(TAX_ID_SQL('"taxId"'))} = ${taxIdKey} ORDER BY "createdAt" ASC, "id" ASC LIMIT 1`;
    if (match) {
      company = await tx.company.findUniqueOrThrow({ where: { id: match.id } });
      companyHow = "encontrada pelo NIF";
    }
  }

  let contact: Contact | null = email
    ? await tx.contact.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })
    : null;
  let contactHow = contact ? "encontrado pelo email" : "";

  if (!company && companyName && !taxIdKey && contact?.companyId) {
    // Sem NIF não há como reconhecer a empresa; a do contacto que a loja já conhece é a melhor pista.
    company = await tx.company.findUniqueOrThrow({ where: { id: contact.companyId } });
    companyHow = "a do contacto";
  }
  if (!company && companyName) {
    company = await tx.company.create({ data: { name: companyName, taxId } });
    companyHow = "criada";
    created.company = true;
  }
  if (!company && taxIdKey) notes.push(`NIF indicado: ${taxId} (não há empresa com este NIF e não veio o nome da empresa para a criar)`);

  if (contact) {
    if (company && contact.companyId && contact.companyId !== company.id) {
      const other = await tx.company.findUnique({ where: { id: contact.companyId }, select: { name: true } });
      notes.push(`O contacto com o email ${email} (${quote(contact.name)}) é de outra empresa${other ? ` (${quote(other.name)})` : ""}: não fica na encomenda`);
      contact = null;
      contactHow = "";
    } else if (company && !contact.companyId) {
      contact = await tx.contact.update({ where: { id: contact.id }, data: { companyId: company.id } });
    }
  } else if (name || email) {
    contact = await tx.contact.create({ data: { name: name ?? email!, email, phone, companyId: company?.id ?? null } });
    contactHow = "criado";
    created.contact = true;
  }

  if (!company && !contact) {
    throw new OrderIntakeError("Não há cliente com estes dados e faltam o nome ou o email para o criar", { field: "customer" });
  }
  const parts = [company ? `empresa ${quote(company.name)} (${companyHow})` : null, contact ? `contacto ${quote(contact.name)} (${contactHow})` : null].filter(Boolean);
  notes.unshift(`Cliente: ${parts.join(" · ")}`);
  return { company, contact, notes, created };
}

export interface ResolvedLine {
  productId: string | null;
  sku: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  vatRate: number;
}

/**
 * Linhas: por referência (produto ativo do catálogo; o preço e o IVA do produto, a menos que venham no pedido) ou
 * livres (o DTO já exige descrição, preço e IVA). Uma linha que não se pode cumprir recusa a encomenda inteira.
 */
export async function resolveLines(tx: Tx, lines: OrderIntakeLine[]): Promise<ResolvedLine[]> {
  const skus = [...new Set(lines.map((l) => l.sku?.trim()).filter((s): s is string => !!s))];
  const products = skus.length
    ? await tx.product.findMany({
        where: { OR: skus.map((sku) => ({ sku: { equals: sku, mode: "insensitive" as const } })) },
        select: { id: true, sku: true, name: true, salePrice: true, vatRate: true, active: true },
      })
    : [];
  const find = (sku: string) => {
    const exact = products.find((p) => p.sku === sku);
    if (exact) return exact;
    const same = products.filter((p) => p.sku.toLowerCase() === sku.toLowerCase());
    return same.length === 1 ? same[0] : null;
  };

  return lines.map((line, index) => {
    const at = `Linha ${index + 1}`;
    const sku = line.sku?.trim();
    const discountPct = line.discountPct ?? 0;
    if (!sku) {
      return { productId: null, sku: null, description: line.description!.trim(), quantity: line.quantity, unitPrice: line.unitPrice!, discountPct, vatRate: line.vatRate! };
    }
    const product = find(sku);
    if (!product) throw new OrderIntakeError(`${at}: não há nenhum produto com a referência «${sku}»`, { line_index: index, sku, reason: "unknown_sku" });
    if (!product.active) throw new OrderIntakeError(`${at}: o produto «${product.sku}» está desativado`, { line_index: index, sku, reason: "inactive_product" });
    const unitPrice = line.unitPrice ?? (product.salePrice === null ? undefined : Number(product.salePrice));
    if (unitPrice === undefined) {
      throw new OrderIntakeError(`${at}: o produto «${product.sku}» não tem preço: indica unit_price`, { line_index: index, sku, reason: "missing_price" });
    }
    return {
      productId: product.id,
      sku: product.sku,
      description: line.description?.trim() || product.name,
      quantity: line.quantity,
      unitPrice,
      discountPct,
      vatRate: line.vatRate ?? Number(product.vatRate),
    };
  });
}
