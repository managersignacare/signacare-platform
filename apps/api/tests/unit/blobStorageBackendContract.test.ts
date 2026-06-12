import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const repoRoot = join(__dirname, '..', '..', '..', '..');
const dummyAzureAccountKey = Buffer.alloc(32, 7).toString('base64');

const ORIGINAL_ENV = {
  BLOB_STORAGE_BACKEND: process.env.BLOB_STORAGE_BACKEND,
  BLOB_AZURE_ACCOUNT_NAME: process.env.BLOB_AZURE_ACCOUNT_NAME,
  BLOB_AZURE_ACCOUNT_KEY: process.env.BLOB_AZURE_ACCOUNT_KEY,
  BLOB_AZURE_CONTAINER: process.env.BLOB_AZURE_CONTAINER,
  BLOB_AZURE_ENDPOINT: process.env.BLOB_AZURE_ENDPOINT,
};

afterEach(() => {
  vi.resetModules();
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('BlobStorage backend deployment contract', () => {
  it('supports native Azure Blob as a first-class backend', async () => {
    process.env.BLOB_STORAGE_BACKEND = 'azure-blob';
    process.env.BLOB_AZURE_ACCOUNT_NAME = 'signacarestorage';
    process.env.BLOB_AZURE_ACCOUNT_KEY = dummyAzureAccountKey;
    process.env.BLOB_AZURE_CONTAINER = 'attachments';
    process.env.BLOB_AZURE_ENDPOINT = 'https://signacarestorage.blob.core.windows.net';

    const { blobStorage } = await import('../../src/shared/blobStorage');

    expect(blobStorage.backendName).toBe('azure-blob');
  });

  it('fails closed when Azure Blob is selected without required settings', async () => {
    process.env.BLOB_STORAGE_BACKEND = 'azure-blob';
    delete process.env.BLOB_AZURE_ACCOUNT_NAME;
    delete process.env.BLOB_AZURE_ACCOUNT_KEY;
    delete process.env.BLOB_AZURE_CONTAINER;

    await expect(import('../../src/shared/blobStorage')).rejects.toThrow(
      /BLOB_STORAGE_BACKEND=azure-blob requires BLOB_AZURE_ACCOUNT_NAME/,
    );
  });

  it('keeps Azure Bicep on the native Azure Blob adapter instead of S3', () => {
    const bicep = readFileSync(join(repoRoot, 'deploy/azure/modules/appservice.bicep'), 'utf8');

    expect(bicep).toContain("{ name: 'BLOB_STORAGE_BACKEND',                   value: 'azure-blob' }");
    expect(bicep).toContain("name: 'BLOB_AZURE_ACCOUNT_NAME'");
    expect(bicep).toContain("name: 'BLOB_AZURE_ACCOUNT_KEY'");
    expect(bicep).toContain("name: 'BLOB_AZURE_CONTAINER'");
    expect(bicep).toMatch(/var apiSlotAppSettings = \[/);
    expect(bicep).toMatch(/resource apiSlot[\s\S]+identity:\s*\{[\s\S]+type: 'SystemAssigned'/);
    expect(bicep).toMatch(/resource apiSlot[\s\S]+appSettings: apiSlotAppSettings/);
    expect(bicep).toMatch(/resource apiSlotKvRole[\s\S]+principalId: apiSlot!\.identity\.principalId/);
    expect(bicep).toMatch(/resource apiSlotAcrPullRole[\s\S]+principalId: apiSlot!\.identity\.principalId/);
    expect(bicep).toMatch(/resource webSlot[\s\S]+identity:\s*\{[\s\S]+type: 'SystemAssigned'/);
    expect(bicep).toMatch(/resource webSlotAcrPullRole[\s\S]+principalId: webSlot!\.identity\.principalId/);
    expect(bicep).not.toMatch(/BLOB_S3_ENDPOINT[\s\S]{0,120}blob\./);
  });

  it('keeps the production template boot-complete for Azure Blob', () => {
    const template = readFileSync(join(repoRoot, 'apps/api/.env.production.template'), 'utf8');

    expect(template).toMatch(/^BLOB_STORAGE_BACKEND=azure-blob$/m);
    expect(template).toMatch(/^BLOB_AZURE_ACCOUNT_NAME=.+$/m);
    expect(template).toMatch(/^BLOB_AZURE_ACCOUNT_KEY=.+$/m);
    expect(template).toMatch(/^BLOB_AZURE_CONTAINER=.+$/m);
    expect(template).toMatch(/^BLOB_AZURE_ENDPOINT=https:\/\/.+\.blob\.core\.windows\.net$/m);
  });

  it('persists the explicit BlobStorage backend returned by the adapter', () => {
    const patientRoutes = readFileSync(join(repoRoot, 'apps/api/src/features/patients/patientRoutes.ts'), 'utf8');
    const patientAncillaryRoutes = readFileSync(
      join(repoRoot, 'apps/api/src/features/patients/patientAncillaryRoutes.ts'),
      'utf8',
    );
    const source = `${patientRoutes}\n${patientAncillaryRoutes}`;

    expect(source).toContain('storage_backend: putResult.backend');
    expect(source).not.toContain("putResult.bucket === 'local' ? 'local' : 's3'");
  });

  it('resolves Azure Blob rows with the row backend even when the active backend is local', async () => {
    process.env.BLOB_STORAGE_BACKEND = 'local';
    process.env.BLOB_AZURE_ACCOUNT_NAME = 'signacarestorage';
    process.env.BLOB_AZURE_ACCOUNT_KEY = dummyAzureAccountKey;
    process.env.BLOB_AZURE_CONTAINER = 'attachments';
    process.env.BLOB_AZURE_ENDPOINT = 'https://signacarestorage.blob.core.windows.net';

    const { blobStorage, resolveAttachmentDownloadUrl } = await import('../../src/shared/blobStorage');
    const url = await resolveAttachmentDownloadUrl({
      storage_backend: 'azure-blob',
      storage_key: 'attachments/2026/test.pdf',
      filename: 'test.pdf',
    });

    expect(blobStorage.backendName).toBe('local');
    expect(url).toMatch(/^https:\/\/signacarestorage\.blob\.core\.windows\.net\/attachments\/attachments\/2026\/test\.pdf\?/);
    expect(url).toContain('sig=');
  });

  it('resolves local rows as auth-gated uploads even when the active backend is Azure Blob', async () => {
    process.env.BLOB_STORAGE_BACKEND = 'azure-blob';
    process.env.BLOB_AZURE_ACCOUNT_NAME = 'signacarestorage';
    process.env.BLOB_AZURE_ACCOUNT_KEY = dummyAzureAccountKey;
    process.env.BLOB_AZURE_CONTAINER = 'attachments';
    process.env.BLOB_AZURE_ENDPOINT = 'https://signacarestorage.blob.core.windows.net';

    const { blobStorage, resolveAttachmentDownloadUrl } = await import('../../src/shared/blobStorage');
    const url = await resolveAttachmentDownloadUrl({
      storage_backend: 'local',
      storage_key: 'attachments/2026/test.pdf',
      filename: 'test.pdf',
    });

    expect(blobStorage.backendName).toBe('azure-blob');
    expect(url).toBe('/uploads/attachments/2026/test.pdf');
  });
});
