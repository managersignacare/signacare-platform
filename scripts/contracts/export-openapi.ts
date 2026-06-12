#!/usr/bin/env tsx
/**
 * Export the API OpenAPI document into the shared package.
 *
 * The backend Swagger spec is the canonical source. This generated artifact is
 * committed so web, mobile, gateway, and release tooling can consume one stable
 * contract without importing backend source.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { swaggerSpec } from '../../apps/api/src/shared/swagger';

const generatedDir = resolve(process.cwd(), 'packages/shared/src/generated');
const jsonPath = resolve(generatedDir, 'openapi.json');
const tsPath = resolve(generatedDir, 'openapi.ts');

mkdirSync(generatedDir, { recursive: true });

const json = `${JSON.stringify(swaggerSpec, null, 2)}\n`;
const ts = `/* AUTO-GENERATED FILE. DO NOT EDIT.
 * Regenerate with: npm run contracts:generate
 */

export type SignacareOpenApiSpec = Record<string, unknown>;

export const signacareOpenApiSpec = JSON.parse(${JSON.stringify(json.trim())}) as SignacareOpenApiSpec;
`;

writeFileSync(jsonPath, json, 'utf8');
writeFileSync(tsPath, ts, 'utf8');

console.log(`Generated ${jsonPath}`);
console.log(`Generated ${tsPath}`);
