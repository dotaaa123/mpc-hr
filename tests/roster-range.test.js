import test from 'node:test';
import assert from 'node:assert/strict';
import { rosterRangeDates } from '../shared/weeklyRegisters.js';

test('roster range ends before selected end date and crosses month boundaries', () => {
  assert.deepEqual(rosterRangeDates('2026-10-23', '2026-10-30'), [
    '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26',
    '2026-10-27', '2026-10-28', '2026-10-29',
  ]);
  assert.deepEqual(rosterRangeDates('2026-10-30', '2026-11-02'), [
    '2026-10-30', '2026-10-31', '2026-11-01',
  ]);
});

test('roster range rejects invalid or excessive dates', () => {
  for (const end of ['2026-10-23', '2026-10-22', '2027-10-25', 'invalid'])
    assert.throws(() => rosterRangeDates('2026-10-23', end));
});
