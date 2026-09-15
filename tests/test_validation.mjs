import assert from 'node:assert';
import { parseVersionTuple, isNewerVersion, LGAdapter } from '../src/lib/brands/lg.ts';

console.log('--- Testing parseVersionTuple ---');
assert.deepStrictEqual(parseVersionTuple('04.64.00'), [4, 64, 0]);
assert.deepStrictEqual(parseVersionTuple('Version_33.31.68'), [33, 31, 68]);
assert.deepStrictEqual(parseVersionTuple('13.30.82'), [13, 30, 82]);
console.log('✓ parseVersionTuple passed!');

console.log('--- Testing isNewerVersion ---');
assert.strictEqual(isNewerVersion('04.64.00', '04.60.00'), true);
assert.strictEqual(isNewerVersion('04.60.00', '04.64.00'), false);
assert.strictEqual(isNewerVersion('33.31.68', '33.31.68'), false);
assert.strictEqual(isNewerVersion('33.31.69', '33.31.68'), true);
assert.strictEqual(isNewerVersion('04.00.00', null), true);
console.log('✓ isNewerVersion passed!');

console.log('--- Testing LGAdapter Model Validation ---');
const adapter = new LGAdapter();

// Test invalid / junk model rejection
console.log('Testing invalid junk model rejection...');
const invalidRes = await adapter.validateAndFetch('NOT_A_REAL_MODEL_123456');
assert.strictEqual(invalidRes.isValid, false);
assert.ok(invalidRes.errorMessage.includes('Could not verify model'));
console.log('✓ Junk model was correctly rejected with message:', invalidRes.errorMessage);

// Test real model verification
console.log('Testing real model verification (OLED65CXPUA.AUS)...');
const realRes = await adapter.validateAndFetch('OLED65CXPUA.AUS');
assert.strictEqual(realRes.isValid, true);
assert.strictEqual(realRes.brand, 'LG');
assert.ok(realRes.latestFirmware?.version);
console.log(`✓ Real model verified! Name: ${realRes.productName}, Latest Version: v${realRes.latestFirmware?.version}`);

console.log('--- All Tests Passed Successfully! ---');
