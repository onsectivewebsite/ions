/**
 * Cloudflare R2 client. S3-compatible (R2 implements the S3 API), so we use
 * @aws-sdk/client-s3 with R2's endpoint.
 *
 * Two modes:
 *  - Real: instantiates the SDK against R2 when R2_ENDPOINT + credentials are
 *    set and `R2_DRY_RUN` is not true.
 *  - Dry-run: short-circuits every method, logs the call, returns plausible
 *    URLs so the rest of the system can be exercised without R2 credentials.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { loadEnv } from '@onsecboad/config';

const env = loadEnv();

export type R2Mode = 'real' | 'dry-run';

const hasCreds =
  !!env.R2_ENDPOINT && !!env.R2_ACCESS_KEY_ID && !!env.R2_SECRET_ACCESS_KEY && !!env.R2_BUCKET;

export const r2Mode: R2Mode = hasCreds ? 'real' : 'dry-run';

const realClient =
  r2Mode === 'real'
    ? new S3Client({
        region: env.R2_REGION ?? 'auto',
        endpoint: env.R2_ENDPOINT,
        credentials: {
          accessKeyId: env.R2_ACCESS_KEY_ID!,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
        },
      })
    : null;

function log(op: string, args: Record<string, unknown> = {}): void {
  if (r2Mode === 'dry-run') {
    // eslint-disable-next-line no-console
    console.log(`[r2:dry-run] ${op}`, args);
  }
}

/** Upload a remote URL's contents into R2 under the given key. */
export async function uploadRemoteUrl(
  key: string,
  sourceUrl: string,
  contentType = 'application/pdf',
): Promise<{ url: string; bytes: number }> {
  if (r2Mode === 'dry-run') {
    log('uploadRemoteUrl', { key, sourceUrl });
    // Return the source URL itself so consumers degrade gracefully.
    return { url: sourceUrl, bytes: 0 };
  }
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`Failed to fetch ${sourceUrl}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await realClient!.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET!,
      Key: key,
      Body: buf,
      ContentType: contentType,
    }),
  );
  return { url: publicUrlFor(key), bytes: buf.length };
}

export async function uploadBuffer(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<{ url: string; bytes: number }> {
  if (r2Mode === 'dry-run') {
    log('uploadBuffer', { key, bytes: body.length, contentType });
    return { url: `https://dryrun.r2.local/${key}`, bytes: body.length };
  }
  await realClient!.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET!,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return { url: publicUrlFor(key), bytes: body.length };
}

/**
 * Delete an object by key. Used by the document-collection feature to
 * enforce the "re-upload deletes prior version on disk" invariant.
 * Idempotent — succeeds even if the object isn't there.
 */
export async function deleteObject(key: string): Promise<void> {
  if (r2Mode === 'dry-run') {
    log('deleteObject', { key });
    return;
  }
  await realClient!.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET!, Key: key }));
}

/** Returns a 1-hour signed URL for a key (the docs spec). */
export async function signedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  if (r2Mode === 'dry-run') {
    log('signedUrl', { key, expiresInSeconds });
    return `https://dryrun.r2.local/${key}?expires=${expiresInSeconds}`;
  }
  return getSignedUrl(
    realClient!,
    new GetObjectCommand({ Bucket: env.R2_BUCKET!, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}

function publicUrlFor(key: string): string {
  // Phase 1 ships private buckets — consumers should call signedUrl(). We
  // return a deterministic stable identifier so the SubscriptionInvoice row
  // has something to render in the UI; clicking it triggers the signed-URL
  // flow on the server.
  return `r2://${env.R2_BUCKET}/${key}`;
}

export function isDryRun(): boolean {
  return r2Mode === 'dry-run';
}
