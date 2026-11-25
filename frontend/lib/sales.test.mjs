import test from 'node:test';
import assert from 'node:assert/strict';
import { salePricePreview, campaignWallTime } from './sales.ts';

test('sale previews calculate the specified individual INR discounts before display conversion',()=>{
  assert.equal(salePricePreview(103684,20),82947.2);
  assert.equal(salePricePreview(135424,35),88025.6);
  assert.equal(salePricePreview(95000,15),80750);
});
test('sale preview rejects invalid discounts, nonfinite prices and rounded zero prices',()=>{
  for(const percent of [0,-1,100,101,NaN,Infinity])assert.equal(salePricePreview(1000,percent),null);
  for(const mrp of [undefined,0,-1,NaN,Infinity])assert.equal(salePricePreview(mrp,20),null);
  assert.equal(salePricePreview(.01,99),null);
});
test('campaign editor displays saved UTC instants in the explicit campaign zone',()=>{
  assert.equal(campaignWallTime('2030-01-01T04:30:00Z','Asia/Kolkata'),'2030-01-01T10:00');
  assert.equal(campaignWallTime('2030-01-01T04:30:00Z','UTC'),'2030-01-01T04:30');
  assert.equal(campaignWallTime('2030-01-01T10:00','Asia/Kolkata'),'2030-01-01T10:00');
  assert.equal(campaignWallTime('2030-01-01T04:30:00Z','Invalid/Zone'),'');
});
