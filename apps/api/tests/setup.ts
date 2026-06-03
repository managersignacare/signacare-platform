// Test setup — load environment variables for test
import { config } from 'dotenv';
config({ path: '.env' });

// Mark this process as a test runner so server.ts (and any other
// modules that auto-start a listener on import) become inert when
// supertest mounts the app in-process. This must be set BEFORE any
// production module is imported by a test file.
process.env.NODE_ENV = 'test';
process.env.TEST_DEFAULT_CLINIC_ID ??= '11111111-1111-1111-1111-111111111111';
