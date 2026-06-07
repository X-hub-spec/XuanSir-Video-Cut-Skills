const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildProjectFromSourceWords,
  buildOrderedKeepSegments,
  computeKeepSegments,
  mapGlobalSegmentToSource,
  normalizeManifest,
} = require('../multicam_utils');

test('normalizes multicam manifest and builds shared global words', () => {
  const manifest = {
    mode: 'multicam',
    projectTitle: '访谈粗剪',
    sources: [
      { id: 'cam_a', kind: 'video', path: '/tmp/cam-a.mp4', name: '机位A', primary: true, duration: 8 },
      { id: 'mic_xuan', kind: 'audio', path: '/tmp/xuan.wav', name: 'Xuan麦', speakerId: 'xuan', offset: 1, duration: 4 },
      { id: 'mic_li', kind: 'audio', path: '/tmp/li.wav', name: 'Li麦', speakerId: 'li', offset: 0, duration: 4 },
    ],
    speakers: [
      { id: 'xuan', name: 'Xuan', color: '#111111' },
      { id: 'li', name: 'Li', color: '#222222' },
    ],
  };

  const project = buildProjectFromSourceWords(manifest, {
    mic_xuan: [
      { text: '你', start: 0, end: 0.2 },
      { text: '好', start: 0.2, end: 0.4 },
    ],
    mic_li: [
      { text: '来', start: 2, end: 2.2 },
    ],
  }, '/tmp');

  const spoken = project.words.filter(word => !word.isGap);
  assert.equal(project.mode, 'multicam');
  assert.equal(spoken[0].speakerId, 'xuan');
  assert.equal(spoken[0].start, 1);
  assert.equal(spoken[2].speakerId, 'li');
  assert.equal(spoken[2].start, 2);
  assert.ok(project.words.some(word => word.isGap && word.start === 0 && word.end === 1));
});

test('computes old single-track keep segments with merged delete gaps', () => {
  const keep = computeKeepSegments([
    { start: 1, end: 2 },
    { start: 2.1, end: 3 },
    { start: 5, end: 6 },
  ], 8);

  assert.deepEqual(keep, [
    { start: 0, end: 1, paragraphId: null },
    { start: 3, end: 5, paragraphId: null },
    { start: 6, end: 8, paragraphId: null },
  ]);
});

test('reorders paragraph intervals before subtracting deletes', () => {
  const keep = buildOrderedKeepSegments({
    duration: 10,
    deleteList: [{ start: 6, end: 7 }],
    paragraphOrder: ['p2', 'p1'],
    paragraphs: [
      { id: 'p1', start: 0, end: 4 },
      { id: 'p2', start: 5, end: 9 },
    ],
  });

  assert.deepEqual(keep, [
    { start: 5, end: 6, paragraphId: 'p2' },
    { start: 7, end: 9, paragraphId: 'p2' },
    { start: 0, end: 4, paragraphId: 'p1' },
  ]);
});

test('maps global timeline segments back to source-local time with offset', () => {
  const mapped = mapGlobalSegmentToSource(
    { start: 5, end: 8 },
    { id: 'mic_xuan', offset: 2, duration: 10 },
  );

  assert.deepEqual(mapped, {
    sourceId: 'mic_xuan',
    start: 3,
    end: 6,
    duration: 3,
    timelineShift: 0,
  });
});

test('keeps single-mode callers outside multicam manifest normalization', () => {
  assert.throws(() => normalizeManifest([{ text: '旧字幕' }]), /必须是对象/);
});
