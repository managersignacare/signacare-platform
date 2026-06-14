#!/usr/bin/env tsx
/**
 * check-env-template-contract — BUG-D10-GUARD-ENV-TEMPLATE (S1)
 *
 * Verifies canonical environment templates are:
 *  1) present
 *  2) non-empty
 *  3) carrying required key contracts for each runtime surface
 *
 * BUG-INFRA-ENV-CONTRACT-GAP (S1)
 *  4) every runtime env key referenced from source code is documented
 *     either in canonical templates or in the env-key catalog.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

type TemplateContract = {
  path: string;
  requiredKeys: string[];
};

const CONTRACTS: TemplateContract[] = [
  {
    path: '.env.example',
    requiredKeys: ['NODE_ENV', 'PORT'],
  },
  {
    path: 'apps/api/.env.example',
    requiredKeys: [
      'NODE_ENV',
      'PORT',
      'DB_HOST',
      'DB_PORT',
      'DB_USER',
      'DB_PASSWORD',
      'DB_NAME',
      'DB_APP_USER',
      'DB_APP_PASSWORD',
      'API_PROCESS_COUNT',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'PHI_ENCRYPTION_KEY',
      'BLIND_INDEX_KEY',
      'PATIENT_APP_DEDUPE_PEPPER',
      'SESSION_SECRET',
      'UPLOAD_BASE_DIR',
      'BLOB_STORAGE_BACKEND',
      'BLOB_AZURE_ACCOUNT_NAME',
      'BLOB_AZURE_ACCOUNT_KEY',
      'BLOB_AZURE_CONTAINER',
      'BLOB_AZURE_ENDPOINT',
      'REDIS_URL',
      'CORS_ORIGIN',
      'API_BASE_URL',
      'MFA_ISSUER',
      'OLLAMA_BASE_URL',
      'AZURE_OPENAI_ENDPOINT',
      'AZURE_OPENAI_AUTH_MODE',
      'AZURE_OPENAI_PRIVATE_NETWORK_ENFORCED',
      'AZURE_OPENAI_API_KEY',
      'AZURE_OPENAI_API_VERSION',
      'AZURE_OPENAI_DEPLOYMENT_FAST_CLINICAL',
      'AZURE_OPENAI_DEPLOYMENT_FAST_CLINICAL_VERSION',
      'AZURE_OPENAI_DEPLOYMENT_BEST_CLINICAL',
      'AZURE_OPENAI_DEPLOYMENT_BEST_CLINICAL_VERSION',
      'WHISPER_API_URL',
      'FCM_SERVICE_ACCOUNT_PATH',
      'ACS_CONNECTION_STRING',
      'ACS_FROM_PHONE',
      'SAFESCRIPT_API_URL',
      'SAFESCRIPT_CLIENT_ID',
      'SAFESCRIPT_CLIENT_SECRET',
    ],
  },
  {
    path: 'apps/api/.env.production.template',
    requiredKeys: [
      'NODE_ENV',
      'PORT',
      'SECRETS_BACKEND',
      'AZURE_KEYVAULT_URL',
      'DB_HOST',
      'DB_PORT',
      'DB_USER',
      'DB_PASSWORD',
      'DB_NAME',
      'DB_APP_USER',
      'DB_APP_PASSWORD',
      'API_PROCESS_COUNT',
      'PGSSLMODE',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'PHI_ENCRYPTION_KEY',
      'BLIND_INDEX_KEY',
      'PATIENT_APP_DEDUPE_PEPPER',
      'SESSION_SECRET',
      'REDIS_URL',
      'API_BASE_URL',
      'CORS_ORIGIN',
      'MFA_ISSUER',
      'OLLAMA_BASE_URL',
      'AZURE_OPENAI_ENDPOINT',
      'AZURE_OPENAI_AUTH_MODE',
      'AZURE_OPENAI_PRIVATE_NETWORK_ENFORCED',
      'AZURE_OPENAI_API_VERSION',
      'AZURE_OPENAI_DEPLOYMENT_FAST_CLINICAL',
      'AZURE_OPENAI_DEPLOYMENT_FAST_CLINICAL_VERSION',
      'AZURE_OPENAI_DEPLOYMENT_BEST_CLINICAL',
      'AZURE_OPENAI_DEPLOYMENT_BEST_CLINICAL_VERSION',
      'WHISPER_API_URL',
      'FCM_SERVICE_ACCOUNT_PATH',
      'ACS_CONNECTION_STRING',
      'ACS_FROM_PHONE',
      'SAFESCRIPT_API_URL',
      'SAFESCRIPT_CLIENT_ID',
      'SAFESCRIPT_CLIENT_SECRET',
      'NPDS_API_URL',
      'NPDS_PAYLOAD_SECURITY_MODE',
      'UPLOAD_BASE_DIR',
      'BLOB_STORAGE_BACKEND',
      'BLOB_AZURE_ACCOUNT_NAME',
      'BLOB_AZURE_ACCOUNT_KEY',
      'BLOB_AZURE_CONTAINER',
      'BLOB_AZURE_ENDPOINT',
    ],
  },
  {
    path: 'apps/emr-gateway/.env.example',
    requiredKeys: [
      'NODE_ENV',
      'PORT',
      'MONGO_URI',
      'EMR_API_KEYS',
      'RATE_LIMIT_WINDOW_MS',
      'RATE_LIMIT_MAX',
      'CORS_ORIGIN',
    ],
  },
  {
    path: 'apps/web/.env.example',
    requiredKeys: [
      'VITE_API_URL',
      'VITE_SCRIBE_LIVE_TRANSCRIPT',
    ],
  },
];

function parseKeysFromTemplate(content: string): Set<string> {
  const keys = new Set<string>();
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/);
    if (match?.[1]) keys.add(match[1]);
  }
  return keys;
}

const ENV_KEY_CATALOG_PATH = 'docs/operations/env-contract-catalog.md';
const AZURE_APPSERVICE_BICEP_PATH = 'deploy/azure/modules/appservice.bicep';

const SOURCE_ROOTS = [
  'apps/api/src',
  'apps/emr-gateway/src',
  'apps/web/src',
] as const;

const BUILTIN_ENV_KEYS = new Set<string>([
  // Vite compile-time built-in.
  'DEV',
]);

function parseKeysFromCatalog(content: string): Set<string> {
  const keys = new Set<string>();
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*-\s*`([A-Z][A-Z0-9_]*)`\s*$/);
    if (match?.[1]) keys.add(match[1]);
  }
  return keys;
}

function validateAzureBlobBicepContract(failures: string[]): void {
  if (!existsSync(AZURE_APPSERVICE_BICEP_PATH)) {
    failures.push(`${AZURE_APPSERVICE_BICEP_PATH}: missing Azure App Service module`);
    return;
  }

  const bicep = readFileSync(AZURE_APPSERVICE_BICEP_PATH, 'utf8');
  const requiredAzureKeys = [
    'BLOB_STORAGE_BACKEND',
    'BLOB_AZURE_ACCOUNT_NAME',
    'BLOB_AZURE_ACCOUNT_KEY',
    'BLOB_AZURE_CONTAINER',
    'BLOB_AZURE_ENDPOINT',
  ];

  if (!/BLOB_STORAGE_BACKEND'[\s\S]{0,120}azure-blob/.test(bicep)) {
    failures.push(`${AZURE_APPSERVICE_BICEP_PATH}: Azure deployment must select BLOB_STORAGE_BACKEND=azure-blob`);
  }

  const missingAzureKeys = requiredAzureKeys.filter((key) => !bicep.includes(key));
  if (missingAzureKeys.length > 0) {
    failures.push(`${AZURE_APPSERVICE_BICEP_PATH}: missing Azure Blob app settings -> ${missingAzureKeys.join(', ')}`);
  }

  if (/BLOB_S3_(BUCKET|REGION|ENDPOINT|ACCESS_KEY_ID|SECRET_ACCESS_KEY)/.test(bicep)) {
    failures.push(`${AZURE_APPSERVICE_BICEP_PATH}: Azure deployment must not wire Azure Blob through BLOB_S3_* settings`);
  }

  if (!/var apiSlotAppSettings = (?:\[|concat\()/.test(bicep)) {
    failures.push(`${AZURE_APPSERVICE_BICEP_PATH}: deployment slot must declare explicit app settings`);
  }
  if (!/resource apiSlot[\s\S]+identity:\s*\{[\s\S]+type: 'SystemAssigned'/.test(bicep)) {
    failures.push(`${AZURE_APPSERVICE_BICEP_PATH}: deployment slot must have a system-assigned identity for Key Vault references`);
  }
  const slotAppSettingsWired =
    /var apiSlotProperties = union\(\{[\s\S]+appSettings: apiSlotAppSettings/.test(bicep) ||
    /resource apiSlot[\s\S]+appSettings: apiSlotAppSettings/.test(bicep);
  if (!slotAppSettingsWired) {
    failures.push(`${AZURE_APPSERVICE_BICEP_PATH}: deployment slot must use Azure Blob app settings before smoke/swap`);
  }
  if (!/resource apiSlotKvRole[\s\S]+principalId: apiSlot!\.identity\.principalId/.test(bicep)) {
    failures.push(`${AZURE_APPSERVICE_BICEP_PATH}: deployment slot identity must receive Key Vault Secrets User role`);
  }
  if (!/resource apiSlotAcrPullRole[\s\S]+principalId: apiSlot!\.identity\.principalId/.test(bicep)) {
    failures.push(`${AZURE_APPSERVICE_BICEP_PATH}: API deployment slot identity must receive AcrPull role`);
  }
  if (!/resource webSlot[\s\S]+identity:\s*\{[\s\S]+type: 'SystemAssigned'/.test(bicep)) {
    failures.push(`${AZURE_APPSERVICE_BICEP_PATH}: web deployment slot must have a system-assigned identity for managed ACR pulls`);
  }
  if (!/resource webSlotAcrPullRole[\s\S]+principalId: webSlot!\.identity\.principalId/.test(bicep)) {
    failures.push(`${AZURE_APPSERVICE_BICEP_PATH}: web deployment slot identity must receive AcrPull role`);
  }
}

function listSourceFiles(dir: string, out: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git' || entry.name === 'coverage' || entry.name === 'build') {
      continue;
    }
    const absolute = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(absolute, out);
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      out.push(absolute);
    }
  }
  return out;
}

function collectRuntimeEnvKeys(filePath: string): Set<string> {
  const source = readFileSync(filePath, 'utf8');
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
  const keys = new Set<string>();
  const add = (candidate: string): void => {
    if (/^[A-Z][A-Z0-9_]*$/.test(candidate)) keys.add(candidate);
  };

  const collectEnvSchemaKeys = (node: ts.Node): void => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return;
    if (!/envSchema$/i.test(node.name.text)) return;
    if (!node.initializer || !ts.isCallExpression(node.initializer)) return;

    const call = node.initializer;
    if (
      !ts.isPropertyAccessExpression(call.expression)
      || !ts.isIdentifier(call.expression.expression)
      || call.expression.expression.text !== 'z'
      || call.expression.name.text !== 'object'
    ) {
      return;
    }

    const [firstArg] = call.arguments;
    if (!firstArg || !ts.isObjectLiteralExpression(firstArg)) return;

    for (const property of firstArg.properties) {
      if (ts.isPropertyAssignment(property)) {
        if (ts.isIdentifier(property.name)) add(property.name.text);
        if (ts.isStringLiteral(property.name)) add(property.name.text);
      }
    }
  };

  const visit = (node: ts.Node): void => {
    collectEnvSchemaKeys(node);

    if (ts.isPropertyAccessExpression(node)) {
      // process.env.KEY
      if (
        ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'process'
        && node.expression.name.text === 'env'
      ) {
        add(node.name.text);
      }
      // import.meta.env.KEY
      if (
        ts.isPropertyAccessExpression(node.expression)
        && ts.isMetaProperty(node.expression.expression)
        && node.expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword
        && node.expression.expression.name.text === 'meta'
        && node.expression.name.text === 'env'
      ) {
        add(node.name.text);
      }
    }

    if (ts.isElementAccessExpression(node)) {
      // process.env['KEY']
      if (
        ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'process'
        && node.expression.name.text === 'env'
      ) {
        const arg = node.argumentExpression;
        if (arg && ts.isStringLiteral(arg)) add(arg.text);
      }
      // import.meta.env['KEY']
      if (
        ts.isPropertyAccessExpression(node.expression)
        && ts.isMetaProperty(node.expression.expression)
        && node.expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword
        && node.expression.expression.name.text === 'meta'
        && node.expression.name.text === 'env'
      ) {
        const arg = node.argumentExpression;
        if (arg && ts.isStringLiteral(arg)) add(arg.text);
      }
    }

    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && (
        node.expression.text === 'requireEnv'
        || node.expression.text === 'optionalEnv'
        || node.expression.text === 'resolvePositiveIntEnv'
      )
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) add(arg.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return keys;
}

function main(): void {
  console.log('→ check-env-template-contract');
  const failures: string[] = [];
  const templateKeys = new Set<string>();

  for (const contract of CONTRACTS) {
    if (!existsSync(contract.path)) {
      failures.push(`${contract.path}: missing file`);
      continue;
    }
    const stats = statSync(contract.path);
    if (!stats.isFile()) {
      failures.push(`${contract.path}: not a regular file`);
      continue;
    }
    if (stats.size === 0) {
      failures.push(`${contract.path}: zero-byte template`);
      continue;
    }
    const content = readFileSync(contract.path, 'utf8');
    const keys = parseKeysFromTemplate(content);
    for (const key of keys) templateKeys.add(key);
    const missing = contract.requiredKeys.filter((key) => !keys.has(key));
    if (missing.length > 0) {
      failures.push(`${contract.path}: missing required keys -> ${missing.join(', ')}`);
    }
  }

  if (!existsSync(ENV_KEY_CATALOG_PATH)) {
    failures.push(`${ENV_KEY_CATALOG_PATH}: missing env-key catalog`);
  } else {
    const stats = statSync(ENV_KEY_CATALOG_PATH);
    if (!stats.isFile()) {
      failures.push(`${ENV_KEY_CATALOG_PATH}: not a regular file`);
    } else if (stats.size === 0) {
      failures.push(`${ENV_KEY_CATALOG_PATH}: zero-byte catalog`);
    }
  }

  const catalogKeys = existsSync(ENV_KEY_CATALOG_PATH)
    ? parseKeysFromCatalog(readFileSync(ENV_KEY_CATALOG_PATH, 'utf8'))
    : new Set<string>();

  const runtimeKeys = new Set<string>();
  for (const root of SOURCE_ROOTS) {
    const files = listSourceFiles(resolve(root));
    for (const file of files) {
      for (const key of collectRuntimeEnvKeys(file)) runtimeKeys.add(key);
    }
  }

  const undocumented = [...runtimeKeys]
    .filter((key) => !BUILTIN_ENV_KEYS.has(key))
    .filter((key) => !templateKeys.has(key) && !catalogKeys.has(key))
    .sort();
  if (undocumented.length > 0) {
    failures.push(`undocumented runtime env keys -> ${undocumented.join(', ')}`);
  }

  const staleCatalog = [...catalogKeys]
    .filter((key) => !runtimeKeys.has(key))
    .sort();
  if (staleCatalog.length > 0) {
    failures.push(`${ENV_KEY_CATALOG_PATH}: stale keys not referenced at runtime -> ${staleCatalog.join(', ')}`);
  }

  validateAzureBlobBicepContract(failures);

  if (failures.length > 0) {
    console.error(`✗ env template contract failed (${failures.length} issue(s))`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log(
    `✓ Env template contract passed (${CONTRACTS.length} template files, ` +
    `${runtimeKeys.size} runtime env keys, ${catalogKeys.size} catalog keys).`,
  );
}

main();
