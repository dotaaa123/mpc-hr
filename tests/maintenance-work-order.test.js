import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMaintenance } from '../shared/maintenance.js';
import { findDependentRecord } from '../server/references.js';

test('WO зогсолт шөнө дамнасан үед минутыг зөв бодно', () => {
  const row=normalizeMaintenance({startTime:'23:30',endTime:'01:15',callTime:'23:00',waitMinutes:30,motorHours:1250});
  assert.equal(row.minutes,105);
  assert.equal(row.status,'closed');
  assert.equal(row.waitMinutes,30);
});

test('холбоотой сэлбэг салгалтыг устгахыг хориглоно', () => {
  assert.deepEqual(findDependentRecord('equipmentTransfers',7,{maintenance:[{id:12,transferIds:[7]}]}),{type:'maintenance',id:12});
});
