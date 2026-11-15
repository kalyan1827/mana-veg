import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryEligibility } from '../apps/backend/src/delivery.mjs';

test('delivery accepts destinations under 20 km and rejects farther points', () => {
  const dispatch = { lat: 17.47, lon: 78.48 };
  const north = km => ({ lat: dispatch.lat + km / 6371 * 180 / Math.PI, lon: dispatch.lon });
  assert.equal(deliveryEligibility(dispatch, north(19.999)).eligible, true);
  assert.equal(deliveryEligibility(dispatch, north(20.001)).eligible, false);
  assert.throws(() => deliveryEligibility({ lat: null, lon: null }, north(5)), RangeError);
});
