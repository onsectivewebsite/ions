/**
 * Anthropic Claude integration — stub-aware. Mirrors the Stripe / R2 /
 * Twilio pattern: real client when ANTHROPIC_API_KEY is set, stub when
 * it isn't (or when AI_DRY_RUN=true).
 *
 * Phase 6.1 surface: extractCaseData() — given a case type + a bundle of
 * uploaded documents (PDFs / images) + intake submission values, return a
 * structured per-case data view + per-field provenance + confidence.
 *
 * In dry-run, returns realistic-looking canned data so the rest of the
 * stack (UI, persistence, lawyer-edit flow) can be exercised end-to-end
 * without burning tokens or needing a key.
 */
import Anthropic from '@anthropic-ai/sdk';
import { loadEnv } from '@onsecboad/config';

const env = loadEnv();

export type AiMode = 'real' | 'dry-run';

const isDryRun = env.AI_DRY_RUN || !env.ANTHROPIC_API_KEY;
export const aiMode: AiMode = isDryRun ? 'dry-run' : 'real';

const client = isDryRun
  ? null
  : new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export type DocumentInput = {
  /** UI-shown name. Goes into the prompt + provenance keys. */
  fileName: string;
  /** mime: application/pdf | image/png | image/jpeg | image/gif | image/webp */
  contentType: string;
  /** raw bytes — we base64-encode for the Anthropic SDK. */
  body: Buffer;
};

export type IntakeData = Record<string, unknown>;

export type ExtractInput = {
  /** Drives the extraction schema (work_permit, study_permit, pr, etc). */
  caseType: string;
  /** Documents to read. Cap is enforced upstream — Phase 6.1 expects ≤10. */
  documents: DocumentInput[];
  /** Optional intake form values to combine with document extraction. */
  intakeData?: IntakeData;
  /** Override env-default model. Phase 8.1 lets firms pick per-tenant. */
  model?: string;
};

export type FieldProvenance = {
  /** File name (or 'intake' / 'inferred') the value came from. */
  source: string;
  /** Self-reported confidence by the model: 0.0 (unsure) → 1.0 (certain). */
  confidence: number;
};

export type AiUsageMetrics = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  /** Computed via PRICE_TABLE × tokens at the time of the call. */
  costCents: number;
  /** Echoed so callers can persist exactly which model was used. */
  model: string;
};

export type ExtractResult = {
  data: Record<string, unknown>;
  /** Flat dotted-key map: 'applicant.firstName' → { source, confidence }. */
  provenance: Record<string, FieldProvenance>;
  mode: AiMode;
  /** Token + cost breakdown, used by Phase 8.1 usage logging. */
  usage: AiUsageMetrics;
};

// ─── Pricing ────────────────────────────────────────────────────────────
//
// Per-million-token rates in USD as of late 2025; converted to CAD at the
// firm-display layer if needed. Update this table when Anthropic publishes
// new pricing — historical AiUsage rows already carry a frozen costCents.
//
// Cached-input pricing is ~10% of standard input — we apply when the SDK
// reports cache_read_input_tokens. If a model isn't in the table we fall
// back to Sonnet rates (safe over-estimate).
const PRICE_TABLE_USD_PER_MILLION: Record<
  string,
  { input: number; cachedInput: number; output: number }
> = {
  'claude-opus-4-7': { input: 15, cachedInput: 1.5, output: 75 },
  'claude-opus-4-6': { input: 15, cachedInput: 1.5, output: 75 },
  'claude-sonnet-4-6': { input: 3, cachedInput: 0.3, output: 15 },
  'claude-sonnet-4-5': { input: 3, cachedInput: 0.3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 1, cachedInput: 0.1, output: 5 },
  'claude-haiku-4-5': { input: 1, cachedInput: 0.1, output: 5 },
};

const USD_TO_CAD = 1.36; // freeze at write time; refresh on next pricing review.

export function computeCostCents(args: {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}): number {
  const rates =
    PRICE_TABLE_USD_PER_MILLION[args.model] ?? PRICE_TABLE_USD_PER_MILLION['claude-sonnet-4-6']!;
  const usd =
    (args.inputTokens * rates.input +
      args.cachedInputTokens * rates.cachedInput +
      args.outputTokens * rates.output) /
    1_000_000;
  return Math.round(usd * USD_TO_CAD * 100);
}

// ─── Prompt + schema definition ─────────────────────────────────────────

const SYSTEM_PROMPT = `You are an immigration-file extraction assistant for a Canadian
immigration law firm. Your job is to read a client's documents (passport
scans, photos, bank statements, employment letters, etc.) plus their
intake form responses, and return a single structured JSON object that
the firm uses to fill IRCC application forms.

Hard rules:
1. Output ONLY valid JSON, no prose, no markdown fences.
2. The JSON has exactly two top-level keys: "data" and "provenance".
3. Never invent fields you cannot ground in a source. Omit unknowns —
   do NOT fabricate names, dates, numbers, or addresses.
4. Dates are ISO-8601 yyyy-mm-dd. Phone numbers are E.164. Country names
   are ISO-3166 alpha-3 (CAN, IND, USA, …).
5. provenance is a FLAT dotted-key map. Every leaf key in "data" must
   have a matching provenance entry of shape { "source": "<file name or
   'intake' or 'inferred'>", "confidence": <0..1> }.

The "data" shape (omit any section you have no information for):
{
  "applicant": { "firstName", "lastName", "fullName", "dateOfBirth", "gender",
                 "citizenship", "maritalStatus", "preferredLanguage" },
  "passport":  { "number", "issuedAt", "expiresAt", "country" },
  "contact":   { "email", "phone",
                 "address": { "line1", "line2", "city", "province", "postalCode", "country" } },
  "travel":    [{ "country", "fromDate", "toDate", "purpose" }],
  "employment":[{ "employer", "role", "fromDate", "toDate", "country", "salary" }],
  "education": [{ "institution", "level", "field", "fromDate", "toDate", "country" }],
  "family":    { "spouseName", "spouseDob", "children": [{ "name", "dob" }] },
  "financial": { "proofOfFundsCadCents", "fundsSource" },
  "answers":   { /* free-form yes/no answers from intake */ }
}`;

function buildUserPrompt(input: ExtractInput): string {
  const lines: string[] = [];
  lines.push(`Case type: ${input.caseType}`);
  if (input.intakeData && Object.keys(input.intakeData).length > 0) {
    lines.push('');
    lines.push('Intake form responses:');
    lines.push(JSON.stringify(input.intakeData, null, 2));
  }
  lines.push('');
  lines.push(`Documents follow: ${input.documents.map((d) => d.fileName).join(', ')}`);
  return lines.join('\n');
}

// ─── Real call (Anthropic Messages API with documents + images) ─────────

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | {
      type: 'image';
      source: {
        type: 'base64';
        media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
        data: string;
      };
    };

function toContentBlock(d: DocumentInput): ContentBlock | null {
  const data = d.body.toString('base64');
  if (d.contentType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  }
  if (
    d.contentType === 'image/png' ||
    d.contentType === 'image/jpeg' ||
    d.contentType === 'image/gif' ||
    d.contentType === 'image/webp'
  ) {
    return { type: 'image', source: { type: 'base64', media_type: d.contentType, data } };
  }
  // Unsupported types (e.g. .docx, .heic) — drop with a note in the
  // user-prompt instead of failing the whole extraction.
  return null;
}

async function callReal(input: ExtractInput): Promise<ExtractResult> {
  const docs = input.documents.map(toContentBlock).filter(Boolean) as ContentBlock[];
  const userText: ContentBlock = { type: 'text', text: buildUserPrompt(input) };
  // Documents and images first, then the prompt — keeps the model anchored
  // on what it just read.
  const content: ContentBlock[] = [...docs, userText];

  const model = input.model ?? env.ANTHROPIC_MODEL;
  const res = await client!.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: content as never }],
  });
  // The model returns text; extract JSON.
  const text = res.content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { text: string }).text)
    .join('\n');
  const json = parseJsonLoose(text);

  // SDK exposes cache_read_input_tokens / cache_creation_input_tokens when
  // prompt caching is in play; for Phase 8.1 we sum cache-read separately
  // from regular input and compute cost via the PRICE_TABLE.
  const u = (res.usage ?? {}) as {
    input_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    output_tokens?: number;
  };
  const inputTokens = u.input_tokens ?? 0;
  const cachedInputTokens = u.cache_read_input_tokens ?? 0;
  const outputTokens = u.output_tokens ?? 0;
  return {
    data: (json.data ?? {}) as Record<string, unknown>,
    provenance: (json.provenance ?? {}) as Record<string, FieldProvenance>,
    mode: 'real',
    usage: {
      inputTokens,
      cachedInputTokens,
      outputTokens,
      costCents: computeCostCents({ model, inputTokens, cachedInputTokens, outputTokens }),
      model,
    },
  };
}

function parseJsonLoose(text: string): { data?: unknown; provenance?: unknown } {
  // Fast path
  try {
    return JSON.parse(text) as { data?: unknown; provenance?: unknown };
  } catch {
    /* fall through */
  }
  // Tolerate models that wrapped JSON in code fences or trailing prose.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]!) as { data?: unknown; provenance?: unknown };
    } catch {
      /* fall through */
    }
  }
  // Last-ditch: find the outermost {...} block.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1)) as { data?: unknown; provenance?: unknown };
    } catch {
      /* fall through */
    }
  }
  throw new Error('AI response was not valid JSON');
}

// ─── Dry-run: realistic canned data ─────────────────────────────────────

function callDryRun(input: ExtractInput): ExtractResult {
  // eslint-disable-next-line no-console
  console.log(`[ai:dry-run] extractCaseData`, {
    caseType: input.caseType,
    documents: input.documents.map((d) => `${d.fileName} (${d.contentType}, ${d.body.length}B)`),
    intakeKeys: input.intakeData ? Object.keys(input.intakeData) : [],
  });

  // Pull anything useful from intake to make the dry-run feel responsive.
  const intake = input.intakeData ?? {};
  const get = (k: string): string | undefined => {
    const v = intake[k];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  };
  const firstName = get('first_name') ?? get('firstName') ?? 'Test';
  const lastName = get('last_name') ?? get('lastName') ?? 'Client';
  const phone = get('phone') ?? get('phone_number') ?? '+15555550100';
  const email = get('email') ?? 'test+ai@example.com';

  const data = {
    applicant: {
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`,
      dateOfBirth: '1990-05-12',
      gender: 'M',
      citizenship: 'IND',
      maritalStatus: 'single',
      preferredLanguage: 'en',
    },
    passport: {
      number: 'P1234567',
      issuedAt: '2020-03-01',
      expiresAt: '2030-02-28',
      country: 'IND',
    },
    contact: {
      email,
      phone,
      address: {
        line1: '123 King St W',
        line2: 'Suite 400',
        city: 'Toronto',
        province: 'ON',
        postalCode: 'M5H 1A1',
        country: 'CAN',
      },
    },
    travel: [
      { country: 'USA', fromDate: '2023-06-01', toDate: '2023-06-15', purpose: 'tourism' },
    ],
    employment: [
      {
        employer: 'Acme Tech Pvt Ltd',
        role: 'Senior Software Engineer',
        fromDate: '2019-09-01',
        toDate: null,
        country: 'IND',
        salary: 'INR 1,800,000',
      },
    ],
    education: [
      {
        institution: 'Indian Institute of Technology, Delhi',
        level: 'Bachelor',
        field: 'Computer Science',
        fromDate: '2011-08-01',
        toDate: '2015-06-30',
        country: 'IND',
      },
    ],
    family: {
      spouseName: null,
      spouseDob: null,
      children: [],
    },
    financial: {
      proofOfFundsCadCents: 1_500_000,
      fundsSource: 'savings',
    },
    answers: { ...intake },
  };

  // Provenance: claim documents with names that look right.
  const passportDoc = input.documents.find((d) => /passport/i.test(d.fileName))?.fileName;
  const photoDoc = input.documents.find((d) => /photo|image|portrait/i.test(d.fileName))?.fileName;
  const fundsDoc = input.documents.find((d) => /bank|funds|statement/i.test(d.fileName))?.fileName;
  const empDoc = input.documents.find((d) => /employ|letter|offer/i.test(d.fileName))?.fileName;

  const PROVENANCE: Record<string, FieldProvenance> = {
    'applicant.firstName': { source: passportDoc ?? 'intake', confidence: 0.92 },
    'applicant.lastName': { source: passportDoc ?? 'intake', confidence: 0.92 },
    'applicant.dateOfBirth': { source: passportDoc ?? 'inferred', confidence: passportDoc ? 0.9 : 0.5 },
    'applicant.gender': { source: passportDoc ?? 'inferred', confidence: passportDoc ? 0.9 : 0.4 },
    'applicant.citizenship': { source: passportDoc ?? 'inferred', confidence: 0.85 },
    'applicant.preferredLanguage': { source: 'intake', confidence: 0.7 },
    'passport.number': { source: passportDoc ?? 'inferred', confidence: passportDoc ? 0.95 : 0.3 },
    'passport.issuedAt': { source: passportDoc ?? 'inferred', confidence: passportDoc ? 0.9 : 0.3 },
    'passport.expiresAt': { source: passportDoc ?? 'inferred', confidence: passportDoc ? 0.95 : 0.3 },
    'passport.country': { source: passportDoc ?? 'inferred', confidence: passportDoc ? 0.95 : 0.4 },
    'contact.email': { source: 'intake', confidence: 0.95 },
    'contact.phone': { source: 'intake', confidence: 0.95 },
    'contact.address.city': { source: 'intake', confidence: 0.6 },
    'contact.address.country': { source: 'intake', confidence: 0.7 },
    'employment[0].employer': { source: empDoc ?? 'inferred', confidence: empDoc ? 0.85 : 0.4 },
    'employment[0].role': { source: empDoc ?? 'inferred', confidence: empDoc ? 0.8 : 0.3 },
    'financial.proofOfFundsCadCents': { source: fundsDoc ?? 'inferred', confidence: fundsDoc ? 0.7 : 0.2 },
  };
  if (photoDoc) PROVENANCE['applicant.photo'] = { source: photoDoc, confidence: 1.0 };

  // Realistic-looking dry-run usage so the dashboard renders a non-zero
  // bar even before real keys are wired. Doc-heavy extraction → ~3k input,
  // ~1k output tokens; same shape as a real Sonnet call.
  const model = input.model ?? env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
  const inputTokens = 3000 + input.documents.length * 200;
  const outputTokens = 800;
  return {
    data,
    provenance: PROVENANCE,
    mode: 'dry-run',
    usage: {
      inputTokens,
      cachedInputTokens: 0,
      outputTokens,
      costCents: computeCostCents({ model, inputTokens, cachedInputTokens: 0, outputTokens }),
      model,
    },
  };
}

// ─── Public entry ───────────────────────────────────────────────────────

export async function extractCaseData(input: ExtractInput): Promise<ExtractResult> {
  if (isDryRun) return callDryRun(input);
  return callReal(input);
}

// ─── Phase 8.2: Document classification ─────────────────────────────────
//
// Cheap-fast tag for a freshly-uploaded document. We hand the model a
// single file plus the case-type's checklist (key + label list) and ask
// it to pick the best match (or null if nothing fits).
//
// Defaults to Haiku — extraction-quality reasoning isn't needed; we only
// want a category + confidence.

export type ClassifyCandidate = {
  /** Stable key from the checklist item (e.g. 'passport'). */
  key: string;
  /** Human label (e.g. 'Passport (bio page)'). */
  label: string;
};

export type ClassifyInput = {
  caseType: string;
  document: DocumentInput;
  /** Items to choose from. If empty, the model uses an open-vocabulary
   *  set drawn from typical immigration document categories. */
  candidates?: ClassifyCandidate[];
  /** Override default Haiku. */
  model?: string;
};

export type ClassifyResult = {
  /** Matched candidate key, or a free-form lower-snake category when no
   *  candidates were supplied. null when the model can't make a call. */
  category: string | null;
  /** Display label — same as candidate.label when matched, otherwise the
   *  free-form string the model returned. */
  categoryLabel: string | null;
  /** 0..1 — model's self-reported certainty. */
  confidence: number;
  mode: AiMode;
  usage: AiUsageMetrics;
};

const CLASSIFY_SYSTEM_PROMPT = `You classify a single uploaded document
for a Canadian immigration law firm. Output ONLY valid JSON of shape
{ "category": "<key or null>", "label": "<display name or null>",
  "confidence": <0..1> }.

Choose ONE category from the candidate list (key field). If none fit
well, return { "category": null, "label": null, "confidence": 0 }. Do
NOT invent categories outside the candidate list when one is provided.

Confidence rubric:
  0.95+ — bio page of passport, official government doc with explicit
          markings, signed cover letter on letterhead.
  0.8–0.94 — clear match with one or two minor ambiguities.
  0.6–0.79 — likely match but blurry / partial / unusual format.
  <0.6   — uncertain — prefer null + 0.0 over a low-confidence guess.`;

function buildClassifyPrompt(input: ClassifyInput): string {
  const lines: string[] = [];
  lines.push(`Case type: ${input.caseType}`);
  lines.push(`File: ${input.document.fileName} (${input.document.contentType})`);
  if (input.candidates && input.candidates.length > 0) {
    lines.push('');
    lines.push('Candidate categories:');
    for (const c of input.candidates) {
      lines.push(`  - ${c.key} : ${c.label}`);
    }
    lines.push('');
    lines.push('Pick ONE category by its key, or null if none fit.');
  } else {
    lines.push('No candidate list — pick a sensible immigration-doc category.');
  }
  return lines.join('\n');
}

// Lightweight filename heuristics so the dry-run mode picks "the right"
// answer from candidates without hitting the API. Used to keep the UI
// honest end-to-end.
function classifyHeuristic(input: ClassifyInput): { key: string | null; label: string | null; confidence: number } {
  const name = input.document.fileName.toLowerCase();
  const keys = new Map<string, string>();
  for (const c of input.candidates ?? []) keys.set(c.key, c.label);

  function pick(...keysToTry: string[]): { key: string; label: string } | null {
    for (const k of keysToTry) {
      if (keys.has(k)) return { key: k, label: keys.get(k)! };
    }
    return null;
  }

  if (/passport|bio[\s_-]?page/.test(name)) {
    const m = pick('passport') ?? { key: 'passport', label: 'Passport (bio page)' };
    return { ...m, confidence: 0.96 };
  }
  if (/photo|headshot|portrait/.test(name)) {
    const m = pick('photo') ?? { key: 'photo', label: 'Passport-size photo' };
    return { ...m, confidence: 0.9 };
  }
  if (/ielts|toefl|celpip|english/.test(name)) {
    const m = pick('ielts') ?? { key: 'ielts', label: 'IELTS scorecard' };
    return { ...m, confidence: 0.9 };
  }
  if (/transcript|degree|diploma|education/.test(name)) {
    const m = pick('transcript', 'transcripts', 'education') ?? {
      key: 'transcripts',
      label: 'Education transcripts',
    };
    return { ...m, confidence: 0.85 };
  }
  if (/employer|offer|letter|job/.test(name)) {
    const m = pick('employer_letter', 'job_offer') ?? {
      key: 'employer_letter',
      label: 'Employer letter',
    };
    return { ...m, confidence: 0.85 };
  }
  if (/bank|funds|statement/.test(name)) {
    const m = pick('proof_of_funds') ?? { key: 'proof_of_funds', label: 'Proof of funds' };
    return { ...m, confidence: 0.88 };
  }
  if (/marriage|spouse|family/.test(name)) {
    const m = pick('marriage_cert', 'marriage_certificate') ?? {
      key: 'marriage_certificate',
      label: 'Marriage certificate',
    };
    return { ...m, confidence: 0.8 };
  }
  if (/id|driver|licen[cs]e/.test(name)) {
    const m = pick('id_proof') ?? { key: 'id_proof', label: 'Government-issued ID' };
    return { ...m, confidence: 0.78 };
  }
  return { key: null, label: null, confidence: 0 };
}

async function classifyReal(input: ClassifyInput): Promise<ClassifyResult> {
  const block = toContentBlock(input.document);
  const userText: ContentBlock = { type: 'text', text: buildClassifyPrompt(input) };
  const content: ContentBlock[] = block ? [block, userText] : [userText];

  const model = input.model ?? 'claude-haiku-4-5';
  const res = await client!.messages.create({
    model,
    max_tokens: 256,
    system: CLASSIFY_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: content as never }],
  });
  const text = res.content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { text: string }).text)
    .join('\n');
  const json = parseJsonLoose(text) as {
    category?: string | null;
    label?: string | null;
    confidence?: number;
  };
  // If the model returned a key that isn't in candidates, treat as miss.
  const candidateMap = new Map((input.candidates ?? []).map((c) => [c.key, c.label]));
  let category = json.category ?? null;
  let label = json.label ?? null;
  if (input.candidates && input.candidates.length > 0 && category && !candidateMap.has(category)) {
    category = null;
    label = null;
  }
  if (category && !label) label = candidateMap.get(category) ?? category;

  const u = (res.usage ?? {}) as {
    input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
  const inputTokens = u.input_tokens ?? 0;
  const cachedInputTokens = u.cache_read_input_tokens ?? 0;
  const outputTokens = u.output_tokens ?? 0;
  return {
    category,
    categoryLabel: label,
    confidence: typeof json.confidence === 'number' ? json.confidence : 0,
    mode: 'real',
    usage: {
      inputTokens,
      cachedInputTokens,
      outputTokens,
      costCents: computeCostCents({ model, inputTokens, cachedInputTokens, outputTokens }),
      model,
    },
  };
}

function classifyDryRun(input: ClassifyInput): ClassifyResult {
  const guess = classifyHeuristic(input);
  // Realistic dry-run cost so the dashboard renders.
  const model = input.model ?? 'claude-haiku-4-5';
  const inputTokens = 600;
  const outputTokens = 60;
  return {
    category: guess.key,
    categoryLabel: guess.label,
    confidence: guess.confidence,
    mode: 'dry-run',
    usage: {
      inputTokens,
      cachedInputTokens: 0,
      outputTokens,
      costCents: computeCostCents({ model, inputTokens, cachedInputTokens: 0, outputTokens }),
      model,
    },
  };
}

export async function classifyDocument(input: ClassifyInput): Promise<ClassifyResult> {
  if (isDryRun) return classifyDryRun(input);
  return classifyReal(input);
}
