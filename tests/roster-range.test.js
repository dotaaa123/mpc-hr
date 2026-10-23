import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRosterSequence, parseRosterPattern, rosterRangeDates } from '../shared/weeklyRegisters.js';

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
  for (const end of ['2026-10-23', '2026-10-22', '2027-12-25', 'invalid'])
    assert.throws(() => rosterRangeDates('2026-10-23', end));
});

test('one pattern maps each day and repeats for multiple employees', () => {
  const days=buildRosterSequence('2026-10-23','in-1, d-3, rr-2, out-1');
  assert.deepEqual(days.map(day=>day.code),['in','d','d','d','rr','rr','out']);
  assert.equal(days.at(-1).date,'2026-10-29');
  const repeated=buildRosterSequence('2026-10-23','in-1, d-3, rr-2, out-1',52);
  assert.equal(repeated.length,364);
  assert.equal(repeated[7].code,'in');
  assert.equal(repeated.at(-1).date,'2027-10-21');
  assert.equal(buildRosterSequence('2026-10-23','in-1, d-3, rr-2, out-1',53).length,371);
});

test('pattern rejects invalid codes and excessive repetition', () => {
  assert.throws(()=>parseRosterPattern('d-0'));
  assert.throws(()=>parseRosterPattern('unknown-1'));
  assert.throws(()=>buildRosterSequence('2026-10-23','d-7',58));
});
