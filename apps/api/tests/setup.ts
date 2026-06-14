// Test setup — load environment variables for test
import { config } from 'dotenv';
config({ path: '.env' });

// Mark this process as a test runner so server.ts (and any other
// modules that auto-start a listener on import) become inert when
// supertest mounts the app in-process. This must be set BEFORE any
// production module is imported by a test file.
process.env.NODE_ENV = 'test';
process.env.TEST_DEFAULT_CLINIC_ID ??= '11111111-1111-1111-1111-111111111111';
process.env.DB_HOST ??= 'localhost';
process.env.DB_PORT ??= '5432';
process.env.DB_USER ??= 'signacare_test';
process.env.DB_PASSWORD ??= 'signacare_test_pw';
process.env.DB_NAME ??= 'signacare_test';
process.env.DB_APP_USER ??= process.env.DB_USER;
process.env.DB_APP_PASSWORD ??= process.env.DB_PASSWORD;
process.env.JWT_ACCESS_SECRET ??= '0123456789abcdef0123456789abcdef';
process.env.JWT_REFRESH_SECRET ??= 'fedcba9876543210fedcba9876543210';
process.env.PHI_ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.BLIND_INDEX_KEY ??= 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
process.env.PATIENT_APP_DEDUPE_PEPPER ??= '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
process.env.SESSION_SECRET ??= 'ffeeddccbbaa99887766554433221100';
process.env.CALENDAR_ICAL_SECRET ??= '1234567890abcdef1234567890abcdef';
