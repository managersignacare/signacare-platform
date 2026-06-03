import { beforeEach, describe, expect, it } from 'vitest';
import { assertReferralAttachmentSafe } from '../../src/shared/referralAttachmentSafety';

describe('referralAttachmentSafety', () => {
  beforeEach(() => {
    process.env.REFERRAL_UPLOAD_ANTIVIRUS_MODE = 'off';
  });

  it('accepts valid pdf payload with matching signature', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%test');
    await expect(
      assertReferralAttachmentSafe({
        originalName: 'referral.pdf',
        mimeType: 'application/pdf',
        buffer: pdf,
      }),
    ).resolves.toBeUndefined();
  });

  it('accepts docx payload when zip signature is present', async () => {
    const docxLike = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
    await expect(
      assertReferralAttachmentSafe({
        originalName: 'letter.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: docxLike,
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects when mime type is not allowlisted', async () => {
    const payload = Buffer.from('MZ fake-exe');
    await expect(
      assertReferralAttachmentSafe({
        originalName: 'payload.exe',
        mimeType: 'application/x-msdownload',
        buffer: payload,
      }),
    ).rejects.toMatchObject({
      code: 'REFERRAL_ATTACHMENT_MIME_NOT_ALLOWED',
      status: 422,
    });
  });

  it('rejects when signature does not match declared mime type', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    await expect(
      assertReferralAttachmentSafe({
        originalName: 'note.pdf',
        mimeType: 'application/pdf',
        buffer: jpeg,
      }),
    ).rejects.toMatchObject({
      code: 'REFERRAL_ATTACHMENT_SIGNATURE_MISMATCH',
      status: 422,
    });
  });
});
