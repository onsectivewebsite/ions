/**
 * PDF AcroForm helpers — read field names from a PDF buffer and fill
 * them from a flat dotted-key data map per a per-template mapping.
 *
 * Approach:
 *   - extractFields() loads the PDF, walks AcroForm getFields(), returns
 *     a list of { name, type } the UI can render in its mapping editor.
 *   - fillPdf() applies each mapping rule: pulls value at `dataPath` from
 *     CaseAiData.merged, formats it (date/phone/raw), writes to the
 *     PDF field. Unknown fields and missing data are silently skipped —
 *     IRCC PDFs commonly carry hundreds of optional checkboxes nobody
 *     uses.
 *
 * pdf-lib supports text fields, checkboxes, radio groups, dropdowns. We
 * cover the first three (the bulk of IRCC forms). Dropdowns + signature
 * fields can land in 6.3 if firms ask.
 */
import { PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup } from 'pdf-lib';

export type DetectedField = {
  name: string;
  type: 'text' | 'checkbox' | 'radio' | 'unknown';
};

export async function extractFields(buf: Buffer): Promise<DetectedField[]> {
  const pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
  const form = pdf.getForm();
  const fields = form.getFields();
  return fields.map((f) => {
    const name = f.getName();
    if (f instanceof PDFTextField) return { name, type: 'text' as const };
    if (f instanceof PDFCheckBox) return { name, type: 'checkbox' as const };
    if (f instanceof PDFRadioGroup) return { name, type: 'radio' as const };
    return { name, type: 'unknown' as const };
  });
}

export type MappingRule = {
  /** Exact field name in the PDF. */
  pdfField: string;
  /** Dotted path into the case data object (`applicant.lastName`). */
  dataPath: string;
  /** Defaults to 'text' when unset. */
  kind?: 'text' | 'checkbox' | 'radio';
  /** For checkboxes: tick when value matches this. Trim+case-insensitive. */
  equals?: string;
  /** For radio groups: the option name to select. Defaults to value. */
  radioOption?: string;
  /** Optional formatter for text fields. */
  format?: 'date_yyyymmdd' | 'date_dd_mm_yyyy' | 'phone_e164' | 'upper' | 'lower';
};

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function formatValue(raw: unknown, format?: MappingRule['format']): string {
  if (raw == null) return '';
  const s = typeof raw === 'string' ? raw : String(raw);
  if (!format) return s;
  switch (format) {
    case 'upper':
      return s.toUpperCase();
    case 'lower':
      return s.toLowerCase();
    case 'phone_e164':
      // Strip everything except + and digits.
      return s.replace(/[^+\d]/g, '');
    case 'date_yyyymmdd': {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return s;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}${m}${day}`;
    }
    case 'date_dd_mm_yyyy': {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return s;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${day}/${m}/${y}`;
    }
    default:
      return s;
  }
}

export type FillReport = {
  filled: number;
  skipped: number;
  missing: string[];
  unknownPdfFields: string[];
};

export async function fillPdf(
  buf: Buffer,
  mapping: MappingRule[],
  data: Record<string, unknown>,
): Promise<{ buffer: Buffer; report: FillReport }> {
  const pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
  const form = pdf.getForm();
  const report: FillReport = { filled: 0, skipped: 0, missing: [], unknownPdfFields: [] };

  for (const rule of mapping) {
    const value = getByPath(data, rule.dataPath);
    let field;
    try {
      field = form.getField(rule.pdfField);
    } catch {
      report.unknownPdfFields.push(rule.pdfField);
      continue;
    }
    const kind = rule.kind ?? (field instanceof PDFCheckBox
      ? 'checkbox'
      : field instanceof PDFRadioGroup
        ? 'radio'
        : 'text');

    if (kind === 'text' && field instanceof PDFTextField) {
      if (value == null || value === '') {
        report.missing.push(rule.dataPath);
        report.skipped += 1;
        continue;
      }
      try {
        field.setText(formatValue(value, rule.format));
        report.filled += 1;
      } catch {
        report.skipped += 1;
      }
      continue;
    }
    if (kind === 'checkbox' && field instanceof PDFCheckBox) {
      const target = (rule.equals ?? '').trim().toLowerCase();
      const got = (value == null ? '' : String(value)).trim().toLowerCase();
      if (target ? got === target : !!value) {
        field.check();
      } else {
        field.uncheck();
      }
      report.filled += 1;
      continue;
    }
    if (kind === 'radio' && field instanceof PDFRadioGroup) {
      const opt = rule.radioOption ?? (value == null ? '' : String(value));
      if (!opt) {
        report.skipped += 1;
        continue;
      }
      try {
        field.select(opt);
        report.filled += 1;
      } catch {
        report.skipped += 1;
      }
      continue;
    }
    report.skipped += 1;
  }

  // Don't flatten — leaves the form fields editable so the lawyer can
  // still tweak in Acrobat before uploading to IRCC. Phase 6.3 can add
  // a "flatten before upload" toggle.
  const out = await pdf.save({ updateFieldAppearances: true });
  return { buffer: Buffer.from(out), report };
}
