const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const {
  buildTimelineInterviewProject,
  parseFcpxmlTimeline,
} = require('../interview_utils');

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-fcpxml-'));
  const cam = path.join(dir, 'cam_a.mp4');
  const mix = path.join(dir, 'mix_audio.wav');
  fs.writeFileSync(cam, '');
  fs.writeFileSync(mix, '');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<fcpxml version="1.10">
  <resources>
    <format id="r1" name="FFVideoFormat1080p" frameDuration="100/3000s" width="1920" height="1080"/>
    <asset id="r2" name="cam_a" duration="10000/1000s" hasVideo="1" hasAudio="1" src="${pathToFileURL(cam).href}"/>
    <asset id="r3" name="mix_audio" duration="12000/1000s" hasVideo="0" hasAudio="1" src="${pathToFileURL(mix).href}"/>
  </resources>
  <library>
    <event name="test">
      <project name="test">
        <sequence format="r1" duration="10000/1000s">
          <spine>
            <asset-clip name="cam_a" ref="r2" offset="0s" start="0s" duration="10000/1000s"/>
            <asset-clip name="mix_audio" ref="r3" lane="-1" role="dialogue" offset="2000/1000s" start="5000/1000s" duration="4000/1000s"/>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`;
  const xmlFile = path.join(dir, 'synced.fcpxml');
  fs.writeFileSync(xmlFile, xml);
  return { dir, xmlFile };
}

test('parses FCPXML timeline assets and clips', () => {
  const { dir, xmlFile } = makeFixture();
  const parsed = parseFcpxmlTimeline(xmlFile, {
    primaryPreviewSourceId: 'cam_a',
  }, dir);

  assert.equal(parsed.sources.length, 2);
  assert.equal(parsed.timelineClips.length, 2);
  assert.equal(parsed.duration, 10);
  assert.equal(parsed.sources.find(source => source.id === 'cam_a').primary, true);
  assert.deepEqual(
    parsed.timelineClips.find(clip => clip.sourceId === 'mix_audio'),
    {
      id: 'clip_2',
      sourceId: 'mix_audio',
      xmlAssetId: 'r3',
      name: 'mix_audio',
      kind: 'audio',
      lane: -1,
      role: 'dialogue',
      enabled: true,
      globalStart: 2,
      localStart: 5,
      duration: 4,
    }
  );
});

test('maps transcript source local words onto global timeline', () => {
  const { dir, xmlFile } = makeFixture();
  const project = buildTimelineInterviewProject({
    mode: 'interview',
    projectTitle: '访谈测试',
    timelineXml: xmlFile,
    transcriptSourceId: 'mix_audio',
    primaryPreviewSourceId: 'cam_a',
  }, [
    { text: '你', start: 5.5, end: 5.7 },
    { text: '好', start: 6.0, end: 6.2, punctuationAfter: '。' },
  ], dir);

  assert.equal(project.mode, 'interview');
  assert.equal(project.transcriptSourceId, 'mix_audio');
  assert.equal(project.primaryPreviewSourceId, 'cam_a');
  assert.equal(project.words.length, 2);
  assert.equal(project.words[0].start, 2.5);
  assert.equal(project.words[0].end, 2.7);
  assert.equal(project.words[1].start, 3);
  assert.equal(project.words[1].punctuationAfter, '。');
});

test('anchors nested connected clips to parent asset-clip timeline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-nested-fcpxml-'));
  const cam = path.join(dir, 'cam.mov');
  const angle = path.join(dir, 'angle.mov');
  const mix = path.join(dir, 'mix.mp3');
  fs.writeFileSync(cam, '');
  fs.writeFileSync(angle, '');
  fs.writeFileSync(mix, '');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<fcpxml version="1.9">
  <resources>
    <format id="r0" name="FFVideoFormat1080p50" frameDuration="1/50s" width="1920" height="1080"/>
    <asset id="r1" name="cam.mov" start="100s" duration="1000s" hasVideo="1" hasAudio="1" src="${pathToFileURL(cam).href}"/>
    <asset id="r2" name="angle.mov" start="500s" duration="1000s" hasVideo="1" hasAudio="1" src="${pathToFileURL(angle).href}"/>
    <asset id="r3" name="mix.mp3" start="0s" duration="900s" hasAudio="1" src="${pathToFileURL(mix).href}"/>
  </resources>
  <library>
    <event name="test">
      <project name="test">
        <sequence format="r0" tcStart="3600s" duration="900s">
          <spine>
            <asset-clip name="cam.mov" ref="r1" offset="3600s" start="100s" duration="100s">
              <asset-clip name="angle.mov" ref="r2" lane="1" offset="100s" start="500s" duration="100s"/>
              <asset-clip name="mix.mp3" ref="r3" lane="2" offset="100s" start="0s" duration="900s"/>
            </asset-clip>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`;
  const xmlFile = path.join(dir, 'nested.fcpxml');
  fs.writeFileSync(xmlFile, xml);
  const parsed = parseFcpxmlTimeline(xmlFile, {
    primaryPreviewSourceId: 'cam.mov',
    sources: [{ name: 'mix.mp3', duration: 900 }],
  }, dir);

  const angleClip = parsed.timelineClips.find(clip => clip.sourceId === 'angle_mov');
  const mixClip = parsed.timelineClips.find(clip => clip.sourceId === 'mix_mp3');
  assert.equal(angleClip.globalStart, 0);
  assert.equal(mixClip.globalStart, 0);
  assert.equal(mixClip.duration, 900);
  assert.equal(parsed.duration, 900);
});

test('requires transcriptSourceId for timeline-driven interview projects', () => {
  const { dir, xmlFile } = makeFixture();
  assert.throws(
    () => buildTimelineInterviewProject({ timelineXml: xmlFile }, [], dir),
    /transcriptSourceId/
  );
});
