#!/usr/bin/env node
/**
 * Signacare EMR — License Activation Tool
 *
 * Usage:
 *   node activate.js                     — Interactive activation
 *   node activate.js --file license.json — Activate from file
 *   node activate.js --check             — Check current license
 *   node activate.js --generate-demo     — Generate a 30-day demo license
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LICENSE_SECRET = process.env.SIGNACARE_LICENSE_SECRET ?? 'signacare-emr-license-signing-key-2026';
const LICENSE_DIR = path.join(os.homedir(), '.signacare');
const LICENSE_FILE = path.join(LICENSE_DIR, 'license.json');

function getMachineId() {
  const parts = [os.hostname(), os.platform(), os.arch(), (os.cpus()[0] || {}).model || 'unknown', os.totalmem().toString()];
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').substring(0, 16);
}

function signLicense(payload) {
  const data = JSON.stringify({
    licenseKey: payload.licenseKey,
    customerEmail: payload.customerEmail,
    edition: payload.edition,
    maxUsers: payload.maxUsers,
    licenseStart: payload.licenseStart,
    licenseEnd: payload.licenseEnd,
    machineId: payload.machineId,
  });
  return crypto.createHmac('sha256', LICENSE_SECRET).update(data).digest('hex');
}

function validateLicense(license) {
  const now = new Date();
  const endDate = new Date(license.licenseEnd);
  const graceEnd = new Date(endDate.getTime() + 14 * 24 * 60 * 60 * 1000);
  const daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

  const expectedSig = signLicense(license);
  if (license.signature !== expectedSig) {
    return { valid: false, error: 'Invalid license signature.' };
  }
  if (now > graceEnd) {
    return { valid: false, error: `License expired on ${license.licenseEnd}. Please renew.`, daysRemaining };
  }
  return {
    valid: true,
    daysRemaining,
    expiryDate: license.licenseEnd,
    edition: license.edition,
    maxUsers: license.maxUsers,
    customerName: license.customerName,
    organisationName: license.organisationName,
    gracePeroid: now > endDate,
  };
}

function generateLicense(params) {
  const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  const licenseKey = `SIGNACARE-${seg()}-${seg()}-${seg()}-${seg()}`;
  const payload = {
    licenseKey,
    customerName: params.customerName,
    customerEmail: params.customerEmail,
    organisationName: params.organisationName,
    edition: params.edition,
    maxUsers: params.maxUsers,
    features: params.features,
    licenseStart: params.licenseStart,
    licenseEnd: params.licenseEnd,
    machineId: params.machineId,
    issuedAt: new Date().toISOString(),
    version: '1.0',
  };
  payload.signature = signLicense(payload);
  return payload;
}

// ── CLI ──

const args = process.argv.slice(2);

if (args.includes('--check')) {
  if (!fs.existsSync(LICENSE_FILE)) {
    console.log('\x1b[31mNo license found.\x1b[0m Activate with: node activate.js');
    process.exit(1);
  }
  const license = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf-8'));
  const status = validateLicense(license);
  console.log('\n\x1b[36m═══ Signacare EMR License Status ═══\x1b[0m');
  console.log(`  Valid:         ${status.valid ? '\x1b[32mYes\x1b[0m' : '\x1b[31mNo\x1b[0m'}`);
  console.log(`  Organisation:  ${license.organisationName}`);
  console.log(`  Customer:      ${license.customerName}`);
  console.log(`  Edition:       ${license.edition}`);
  console.log(`  Max Users:     ${license.maxUsers}`);
  console.log(`  Expires:       ${license.licenseEnd}`);
  console.log(`  Days Left:     ${status.daysRemaining}`);
  console.log(`  Features:      ${(license.features || []).join(', ')}`);
  console.log(`  License Key:   ${license.licenseKey}`);
  if (status.gracePeroid) console.log('  \x1b[33mWARNING: In 14-day grace period. Renew immediately.\x1b[0m');
  if (status.error) console.log(`  \x1b[31mError: ${status.error}\x1b[0m`);
  console.log();
  process.exit(status.valid ? 0 : 1);

} else if (args.includes('--generate-demo')) {
  const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const license = generateLicense({
    customerName: 'Demo User',
    customerEmail: 'demo@signacare.com',
    organisationName: 'Demo Organisation',
    edition: 'single-user',
    maxUsers: 1,
    features: ['ai-scribe', 'reports', 'assessments', 'medications', 'correspondence'],
    licenseStart: new Date().toISOString().split('T')[0],
    licenseEnd: endDate,
  });
  fs.mkdirSync(LICENSE_DIR, { recursive: true });
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(license, null, 2));
  console.log(`\n\x1b[32mDemo license activated!\x1b[0m`);
  console.log(`  Expires: ${endDate} (30 days)`);
  console.log(`  Key:     ${license.licenseKey}`);
  console.log(`  Saved:   ${LICENSE_FILE}\n`);

} else if (args.includes('--file')) {
  const fileIdx = args.indexOf('--file');
  const filePath = args[fileIdx + 1];
  if (!filePath || !fs.existsSync(filePath)) {
    console.error('License file not found:', filePath);
    process.exit(1);
  }
  const license = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const status = validateLicense(license);
  if (status.valid || status.gracePeroid) {
    fs.mkdirSync(LICENSE_DIR, { recursive: true });
    fs.writeFileSync(LICENSE_FILE, JSON.stringify(license, null, 2));
    console.log(`\n\x1b[32mLicense activated!\x1b[0m`);
    console.log(`  Organisation: ${license.organisationName}`);
    console.log(`  Expires:      ${license.licenseEnd} (${status.daysRemaining} days)`);
    console.log(`  Edition:      ${license.edition}`);
    console.log(`  Saved:        ${LICENSE_FILE}\n`);
  } else {
    console.error(`\x1b[31mLicense invalid: ${status.error}\x1b[0m`);
    process.exit(1);
  }

} else if (args.includes('--generate')) {
  // Admin tool: generate a license for a customer
  const nameIdx = args.indexOf('--name');
  const emailIdx = args.indexOf('--email');
  const orgIdx = args.indexOf('--org');
  const editionIdx = args.indexOf('--edition');
  const usersIdx = args.indexOf('--users');
  const daysIdx = args.indexOf('--days');

  const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1], 10) : 365;
  const endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const license = generateLicense({
    customerName: nameIdx >= 0 ? args[nameIdx + 1] : 'Customer',
    customerEmail: emailIdx >= 0 ? args[emailIdx + 1] : 'customer@example.com',
    organisationName: orgIdx >= 0 ? args[orgIdx + 1] : 'Organisation',
    edition: editionIdx >= 0 ? args[editionIdx + 1] : 'team',
    maxUsers: usersIdx >= 0 ? parseInt(args[usersIdx + 1], 10) : 10,
    features: ['ai-scribe', 'emr-gateway', 'eRx', 'safescript', 'reports', 'mbs-billing', 'assessments', 'medications', 'correspondence'],
    licenseStart: new Date().toISOString().split('T')[0],
    licenseEnd: endDate,
  });

  const outFile = `license-${license.licenseKey}.json`;
  fs.writeFileSync(outFile, JSON.stringify(license, null, 2));
  console.log(`\n\x1b[32mLicense generated!\x1b[0m`);
  console.log(`  Key:      ${license.licenseKey}`);
  console.log(`  Customer: ${license.customerName} (${license.customerEmail})`);
  console.log(`  Org:      ${license.organisationName}`);
  console.log(`  Edition:  ${license.edition} (${license.maxUsers} users)`);
  console.log(`  Valid:    ${license.licenseStart} to ${license.licenseEnd} (${days} days)`);
  console.log(`  File:     ${outFile}\n`);
  console.log('Send this file to the customer for activation:');
  console.log(`  node activate.js --file ${outFile}\n`);

} else {
  // Interactive activation
  console.log('\n\x1b[36m═══ Signacare EMR License Activation ═══\x1b[0m\n');
  console.log('Options:');
  console.log('  node activate.js --generate-demo      Generate 30-day demo license');
  console.log('  node activate.js --file license.json   Activate from license file');
  console.log('  node activate.js --check               Check current license');
  console.log('');
  console.log('For customers:');
  console.log('  1. You should have received a license.json file from Signacare EMR');
  console.log('  2. Run: node activate.js --file /path/to/license.json');
  console.log('');
  console.log('For sales/admin:');
  console.log('  node activate.js --generate --name "Dr Smith" --email "dr@clinic.com" --org "City Mental Health" --edition team --users 20 --days 365');
  console.log(`\n  Machine ID: ${getMachineId()}\n`);
}
