/**
 * Document collection helpers — pick the best checklist template for a
 * case, instantiate a Collection in DRAFT (lazy on first read), generate
 * + hash public tokens.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@onsecboad/db';
import { logger } from '../logger.js';

export type ChecklistItem = {
  key: string;
  label: string;
  description?: string;
  required?: boolean;
  accept?: string[];
  maxSizeMb?: number;
};

const DEFAULT_ITEMS: ChecklistItem[] = [
  { key: 'passport', label: 'Passport (bio page)', required: true, accept: ['application/pdf', 'image/png', 'image/jpeg'], maxSizeMb: 25 },
  { key: 'photo', label: 'Recent passport-size photo', required: true, accept: ['image/png', 'image/jpeg'], maxSizeMb: 10 },
  { key: 'id_proof', label: 'Government-issued ID', required: false, accept: ['application/pdf', 'image/png', 'image/jpeg'], maxSizeMb: 25 },
  { key: 'proof_of_funds', label: 'Proof of funds (bank statement)', required: false, accept: ['application/pdf'], maxSizeMb: 25 },
];

export async function pickChecklistTemplate(
  prisma: PrismaClient,
  tenantId: string,
  caseType: string,
): Promise<{ id: string | null; itemsJson: ChecklistItem[] }> {
  const t = await prisma.documentChecklistTemplate.findFirst({
    where: { tenantId, caseType, isActive: true, isDefault: true },
  });
  if (t) return { id: t.id, itemsJson: t.itemsJson as unknown as ChecklistItem[] };
  const tAny = await prisma.documentChecklistTemplate.findFirst({
    where: { tenantId, caseType, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (tAny) return { id: tAny.id, itemsJson: tAny.itemsJson as unknown as ChecklistItem[] };
  const tDefault = await prisma.documentChecklistTemplate.findFirst({
    where: { tenantId, caseType: null, isActive: true, isDefault: true },
  });
  if (tDefault) return { id: tDefault.id, itemsJson: tDefault.itemsJson as unknown as ChecklistItem[] };
  const tFallback = await prisma.documentChecklistTemplate.findFirst({
    where: { tenantId, caseType: null, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (tFallback) return { id: tFallback.id, itemsJson: tFallback.itemsJson as unknown as ChecklistItem[] };
  return { id: null, itemsJson: DEFAULT_ITEMS };
}

export async function ensureDocumentCollection(
  prisma: PrismaClient,
  args: { tenantId: string; caseId: string; actorId: string },
): Promise<{ collectionId: string; created: boolean }> {
  const existing = await prisma.documentCollection.findUnique({
    where: { caseId: args.caseId },
  });
  if (existing) return { collectionId: existing.id, created: false };

  const c = await prisma.case.findFirst({
    where: { id: args.caseId, tenantId: args.tenantId, deletedAt: null },
    select: { id: true, caseType: true },
  });
  if (!c) throw new Error('Case not found for collection instantiation');

  const tpl = await pickChecklistTemplate(prisma, args.tenantId, c.caseType);
  const created = await prisma.documentCollection.create({
    data: {
      tenantId: args.tenantId,
      caseId: c.id,
      templateId: tpl.id,
      itemsJson: tpl.itemsJson as unknown as Prisma.InputJsonValue,
      status: 'DRAFT',
      createdBy: args.actorId,
    },
  });
  logger.info(
    { caseId: c.id, collectionId: created.id, templateId: tpl.id },
    'document collection instantiated',
  );
  return { collectionId: created.id, created: true };
}

/** Generates a 32-byte URL-safe token; returns plaintext + sha256 hash. */
export function makeCollectionToken(): { plaintext: string; hash: string } {
  const plaintext = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(plaintext).digest('hex');
  return { plaintext, hash };
}

export function hashCollectionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
