#!/usr/bin/env tsx
/**
 * Staging/prod web proxy contract for Ambient AI and scribe uploads.
 *
 * Local dev calls the API directly, but deployed web traffic goes through
 * apps/web/nginx.conf first. This guard prevents nginx's default 1 MB body
 * limit from silently returning 413 before ambient-note reaches the API.
 * The proxy contract preserves the upload body allowance and keeps the web
 * proxy above the non-ambient AI summary timeout. The ambient-note caller/API
 * carry their own lower synchronous cap; long-form psychiatric interviews must
 * use the async scribe job workflow.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const WEB_NGINX = 'apps/web/nginx.conf';
const WEB_DOCKERFILE = 'apps/web/Dockerfile';
const AZURE_DEPLOY_WORKFLOW = '.github/workflows/azure-deploy.yml';

function main(): number {
  const source = readFileSync(resolve(ROOT, WEB_NGINX), 'utf8');
  const dockerfile = readFileSync(resolve(ROOT, WEB_DOCKERFILE), 'utf8');
  const workflow = readFileSync(resolve(ROOT, AZURE_DEPLOY_WORKFLOW), 'utf8');
  const violations: string[] = [];

  const bodyLimitCount = source.match(/client_max_body_size\s+256m;/g)?.length ?? 0;
  if (bodyLimitCount < 2) {
    violations.push('apps/web/nginx.conf must set client_max_body_size 256m at server and /api/ levels');
  }

  const apiLocation = source.match(/location\s+\/api\/\s*\{([\s\S]*?)\n\s*\}/);
  if (!apiLocation) {
    violations.push('apps/web/nginx.conf must contain a location /api/ proxy block');
  } else {
    const apiBlock = apiLocation[1];
    const checks: Array<{ pattern: RegExp; reason: string }> = [
      {
        pattern: /client_max_body_size\s+256m;/,
        reason: '/api/ must allow 256 MB ambient/scribe uploads',
      },
      {
        pattern: /proxy_send_timeout\s+660s;/,
        reason: '/api/ proxy_send_timeout must stay above the 600s non-ambient AI summary timeout',
      },
      {
        pattern: /proxy_read_timeout\s+660s;/,
        reason: '/api/ proxy_read_timeout must stay above the 600s non-ambient AI summary timeout',
      },
    ];

    for (const check of checks) {
      if (!check.pattern.test(apiBlock)) violations.push(check.reason);
    }
  }

  if (!/ARG VITE_API_URL=\/api\/v1/.test(dockerfile)) {
    violations.push('apps/web/Dockerfile must default VITE_API_URL to same-origin /api/v1');
  }

  if (!/API_URL="\/api\/v1"/.test(workflow)) {
    violations.push('.github/workflows/azure-deploy.yml must build web with VITE_API_URL=/api/v1');
  }

  if (/API_URL="https:\/\/\$\{\{ env\.NAME_PREFIX \}\}-api-\$\{ENV\}\.azurewebsites\.net\/api"/.test(workflow)) {
    violations.push('.github/workflows/azure-deploy.yml must not bake absolute API host /api without /v1 into the web image');
  }

  if (violations.length > 0) {
    console.error('web nginx AI upload contract failed:');
    for (const violation of violations) console.error(`  - ${violation}`);
    return 1;
  }

  console.log('web nginx AI upload contract passed.');
  return 0;
}

if (require.main === module) {
  process.exit(main());
}
