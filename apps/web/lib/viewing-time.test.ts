import assert from 'node:assert/strict';
import test from 'node:test';
import { viewingTimeToUtc } from './viewing-time.js';

void test('viewing times preserve Cameroon and non-Cameroon IANA timezone offsets', () => {
  assert.equal(viewingTimeToUtc('2027-01-12T14:00', 'Africa/Douala'), '2027-01-12T13:00:00.000Z');
  assert.equal(viewingTimeToUtc('2027-07-12T14:00', 'Europe/Paris'), '2027-07-12T12:00:00.000Z');
  assert.equal(viewingTimeToUtc('2027-01-12T14:00', 'Asia/Kathmandu'), '2027-01-12T08:15:00.000Z');
});
void test('viewing times reject malformed calendar entries, zones, DST gaps and ambiguity', () => {
  for (const [local, zone] of [
    ['2027-02-30T14:00', 'Africa/Douala'], ['2027-01-12T24:00', 'Africa/Douala'],
    ['2027-01-12', 'Africa/Douala'], ['2027-01-12T14:00', 'Invalid/Zone'],
    ['2027-03-28T02:30', 'Europe/Paris'], ['2027-10-31T02:30', 'Europe/Paris']
  ]) assert.throws(() => viewingTimeToUtc(local!, zone!));
});
