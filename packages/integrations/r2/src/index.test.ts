import { describe, it, expect } from 'vitest';
import { isDryRun, r2Mode, signedUrl, uploadBuffer, uploadRemoteUrl } from './index';

describe('r2 stub (dry-run)', () => {
  it('falls back to dry-run when no credentials are set', () => {
    expect(r2Mode).toBe('dry-run');
    expect(isDryRun()).toBe(true);
  });

  it('uploadBuffer returns a fake URL with the correct byte count', async () => {
    const r = await uploadBuffer('foo/bar.pdf', Buffer.from('hello'), 'application/pdf');
    expect(r.bytes).toBe(5);
    expect(r.url).toMatch(/^https:\/\/dryrun\.r2\.local\//);
  });

  it('uploadRemoteUrl echoes the source URL in dry-run', async () => {
    const r = await uploadRemoteUrl('foo/bar.pdf', 'https://example.com/x.pdf');
    expect(r.url).toBe('https://example.com/x.pdf');
    expect(r.bytes).toBe(0);
  });

  it('signedUrl returns a deterministic dry-run URL', async () => {
    const url = await signedUrl('foo/bar.pdf', 600);
    expect(url).toMatch(/expires=600/);
  });
});
