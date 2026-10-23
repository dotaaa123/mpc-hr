import test from 'node:test';
import assert from 'node:assert/strict';
import { permissionMatrix } from '../shared/pageAccess.js';
import { rosterEmployeeView } from '../shared/weeklyRegisters.js';

test('custom role retains CRUD rights on records and can see roster when granted', () => {
  const actions=['read','create','update','delete'];
  const matrix=permissionMatrix('custom_roster',{}, {
    employees:['read'],rosterEntries:actions,rosterSketch:['read'],
    maintenance:actions,
  },['employees','rosterEntries','maintenance']);
  assert.deepEqual(matrix.rosterEntries,actions);
  assert.deepEqual(matrix.maintenance,actions);
  assert.deepEqual(matrix.rosterSketch,['read']);
  assert.deepEqual(matrix.permissions,[]);
});

test('roster read permission opens sketch and reveals only scheduling employee fields', () => {
  const matrix=permissionMatrix('custom_roster',{}, {rosterEntries:['read','create','update','delete'],rosterSketch:[]},['employees','rosterEntries']);
  assert.deepEqual(matrix.rosterSketch,['read']);
  const employee=rosterEmployeeView({id:7,firstName:'Нэр',lastName:'Овог',shiftGroup:'A',shiftStart:'2026-10-23',bankAccount:'123',baseSalary:1000});
  assert.equal(employee.firstName,'Нэр');
  assert.equal(employee.bankAccount,undefined);
  assert.equal(employee.baseSalary,undefined);
});
