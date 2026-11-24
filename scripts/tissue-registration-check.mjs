import assert from 'node:assert/strict';
import { fitTissue, project, unproject } from '../frontend/src/tissue-registration.ts';

// Stage 15 overview landmarks in a 600 × 600 frame. Use A and B for the transform, C and D for error.
const reference = {
  HR: [[117836, 82278], [.262583, .262583], [[227,251], [132,226], [249,271], [203,425]]],
  KI: [[87127, 82682], [.262583, .262583], [[325,251], [196,217], [367,270], [280,425]]],
  PR: [[85106, 82076], [.262583, .262583], [[324,249], [193,219], [359,267], [284,424]]],
  TP: [[79651, 82884], [.262583, .262583], [[323,238], [188,221], [365,254], [299,413]]],
  NDPI: [[49920, 59904], [.229689689, .229731903], [[270,74], [304,154], [309,248], [333,300]]],
  SVS: [[70685, 87947], [.263526, .263526], [[86,53], [105,100], [111,156], [125,187]]],
};
const pixels = ([dimensions, mpp, points]) => points.map((point) => point.map((value, axis) => value * dimensions[axis] / 600));
const points = [[0,0], [10,0], [3,4], [5,-3]];
const rotated = points.map(([x,y]) => [6 - 2*y, -4 + 2*x]);
const test = fitTissue(points, rotated, { mpp_x: .5, mpp_y: .3 });
assert.equal(test.rms, 0);
assert.equal(test.fit.scale, 2);
assert.deepEqual(project([11,8], test.fit), [-10,18]);
assert.deepEqual(unproject([-10,18], test.fit), [11,8]);
assert.equal(fitTissue(points, rotated, { mpp_x: null, mpp_y: .5 }).unit, 'px');
assert.equal(fitTissue([[0, 0], [0, 0], [3, 4]], rotated.slice(0, 3), { mpp_x: .5, mpp_y: .3 }), undefined);
console.log("PASS: similarity transform, inverse transform, pixel fallback and duplicate fit landmarks");
console.log("Source Target RMS(mm) Maximum(mm)");
for (const [source, target] of [['HR','KI'], ['HR','PR'], ['HR','TP'], ['KI','PR'], ['KI','TP'], ['PR','TP'], ['NDPI','SVS']]) {
  const [mpp_x, mpp_y] = reference[target][1];
  const outcome = fitTissue(pixels(reference[source]), pixels(reference[target]), { mpp_x, mpp_y });
  console.log(source, target, (outcome.rms / 1000).toFixed(3), (outcome.maximum / 1000).toFixed(3));
}
