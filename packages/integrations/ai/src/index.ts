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
};

export type FieldProvenance = {
  /** File name (or 'intake' / 'inferred') the value came from. */
  source: string;
  /** Self-reported confidence by the model: 0.0 (unsure) → 1.0 (certain). */
  confidence: number;
};

export type ExtractResult = {
  data: Record<string, unknown>;
  /** Flat dotted-key map: 'applicant.firstName' → { source, confidence }. */
  provenance: Record<string, FieldProvenance>;
  mode: AiMode;
};

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

  const res = await client!.messages.create({
    model: env.ANTHROPIC_MODEL,
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
  return {
    data: (json.data ?? {}) as Record<string, unknown>,
    provenance: (json.provenance ?? {}) as Record<string, FieldProvenance>,
    mode: 'real',
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

  return { data, provenance: PROVENANCE, mode: 'dry-run' };
}

// ─── Public entry ───────────────────────────────────────────────────────

export async function extractCaseData(input: ExtractInput): Promise<ExtractResult> {
  if (isDryRun) return callDryRun(input);
  return callReal(input);
}
