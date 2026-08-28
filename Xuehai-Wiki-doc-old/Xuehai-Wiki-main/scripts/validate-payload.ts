#!/usr/bin/env tsx

/**
 * Build-time payload validation script
 * This script validates the payload configuration against the JSON Schema
 * and exits with an error code if validation fails.
 */

import { validatePayload } from '../lib/payload/validator';
import payload from '../payload/config';

function main() {
  console.log('🔍 Validating payload configuration...\n');

  const validation = validatePayload(payload);

  if (!validation.valid) {
    console.error('❌ Payload validation failed:\n');
    validation.errors?.forEach((err) => {
      console.error(`  • ${err}`);
    });
    console.error('\nPlease fix the errors in payload/config.ts and try again.\n');
    process.exit(1);
  }

  console.log('✅ Payload validation passed!\n');
  process.exit(0);
}

main();
