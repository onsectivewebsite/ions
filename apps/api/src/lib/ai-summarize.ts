/**
 * AI summarization workers — Phase 8.4.
 *
 * Two entry points:
 *   summarizeCallAsync(prisma, callLogId, twilioTranscriptionText?)
 *   summarizeConsultationAsync(prisma, appointmentId)
 *
 * Both are best-effort: failures log + swallow rather than block the
 * upstream operation (call recording webhook, appointment outcome).
 *
 * Gating: AiSettings.enabled + monthly budget cap. There's no per-feature
 * toggle for summary in 8.4 — summary rides the master switch. If a firm
 * doesn't want summaries, they disable AI entirely.
 *
 * Each call logs to AiUsage with feature='summary' and refType=
 * 'CallLog' / 'Appointment' so /settings/ai/usage breaks them out.
 */
import type { PrismaClient } from '@onsecboad/db';
import {
  summarizeCallTranscript,
  summarizeConsultation,
  transcribeRecording,
} from '@onsecboad/ai';
import { logger } from '../logger.js';
import { getAiSettings, logAiUsage, monthToDateCostCents } from './ai-usage.js';

async function budgetOk(prisma: PrismaClient, tenantId: string): Promise<boolean> {
  const settings = await getAiSettings(prisma, tenantId);
  if (!settings.enabled) return false;
  if (settings.monthlyBudgetCents > 0) {
    const mtd = await monthToDateCostCents(prisma, tenantId);
    if (mtd >= settings.monthlyBudgetCents) return false;
  }
  return true;
}

export async function summarizeCallAsync(
  prisma: PrismaClient,
  callLogId: string,
  twilioTranscriptionText?: string | null,
): Promise<void> {
  try {
    const call = await prisma.callLog.findUnique({
      where: { id: callLogId },
      include: {
        agent: { select: { name: true } },
        lead: { select: { firstName: true, lastName: true } },
      },
    });
    if (!call) return;
    if (call.status !== 'completed') return;
    if (!(await budgetOk(prisma, call.tenantId))) {
      logger.info({ callLogId }, 'summarizeCall: gated by settings/budget');
      return;
    }

    // Step 1: produce a transcript. Prefers Twilio's text; falls back to
    // a stub placeholder when no STT is configured.
    const transcribed = await transcribeRecording({
      recordingUrl: call.recordingUrl,
      twilioTranscriptionText: twilioTranscriptionText ?? null,
      durationSec: call.durationSec ?? undefined,
    });

    // Step 2: summarize via Claude. Skip when transcript is the
    // "no STT" placeholder — no point burning tokens summarizing a
    // null transcript.
    if (transcribed.source === 'stub' && transcribed.mode === 'real') {
      await prisma.callLog.update({
        where: { id: call.id },
        data: {
          transcript: transcribed.transcript,
          transcriptSource: transcribed.source,
        },
      });
      return;
    }

    const summary = await summarizeCallTranscript({
      transcript: transcribed.transcript,
      durationSec: call.durationSec ?? undefined,
      agentName: call.agent?.name ?? undefined,
      leadFirstName: call.lead?.firstName ?? undefined,
      leadLastName: call.lead?.lastName ?? undefined,
    });

    await prisma.callLog.update({
      where: { id: call.id },
      data: {
        transcript: transcribed.transcript,
        transcriptSource: transcribed.source,
        aiSummary: summary.summary,
        aiSummarizedAt: new Date(),
        aiSummaryMode: summary.mode,
      },
    });

    await logAiUsage(prisma, {
      tenantId: call.tenantId,
      feature: 'summary',
      model: summary.usage.model,
      inputTokens: summary.usage.inputTokens,
      cachedInputTokens: summary.usage.cachedInputTokens,
      outputTokens: summary.usage.outputTokens,
      costCents: summary.usage.costCents,
      mode: summary.mode,
      refType: 'CallLog',
      refId: call.id,
    });
  } catch (err) {
    logger.warn({ err, callLogId }, 'summarizeCallAsync failed');
  }
}

export async function summarizeConsultationAsync(
  prisma: PrismaClient,
  appointmentId: string,
): Promise<void> {
  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        provider: { select: { name: true } },
        client: { select: { language: true } },
      },
    });
    if (!appt) return;
    const noteLen = (appt.notes?.length ?? 0) + (appt.outcomeNotes?.length ?? 0);
    if (noteLen < 20) {
      // Not enough to summarize — skip without burning tokens.
      return;
    }
    if (!(await budgetOk(prisma, appt.tenantId))) {
      logger.info({ appointmentId }, 'summarizeConsult: gated by settings/budget');
      return;
    }

    const summary = await summarizeConsultation({
      caseType: appt.caseType,
      providerName: appt.provider.name,
      durationMin: appt.durationMin,
      kind: appt.kind,
      outcome: appt.outcome ?? null,
      notes: appt.notes ?? null,
      outcomeNotes: appt.outcomeNotes ?? null,
      language: appt.client?.language ?? 'en',
    });

    await prisma.appointment.update({
      where: { id: appt.id },
      data: {
        aiSummary: summary.summary,
        aiSummarizedAt: new Date(),
        aiSummaryMode: summary.mode,
      },
    });

    await logAiUsage(prisma, {
      tenantId: appt.tenantId,
      feature: 'summary',
      model: summary.usage.model,
      inputTokens: summary.usage.inputTokens,
      cachedInputTokens: summary.usage.cachedInputTokens,
      outputTokens: summary.usage.outputTokens,
      costCents: summary.usage.costCents,
      mode: summary.mode,
      refType: 'Appointment',
      refId: appt.id,
    });
  } catch (err) {
    logger.warn({ err, appointmentId }, 'summarizeConsultationAsync failed');
  }
}
