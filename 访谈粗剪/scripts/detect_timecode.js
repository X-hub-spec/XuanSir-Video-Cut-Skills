#!/usr/bin/env node

const { detectEmbeddedTimecode } = require('./interview_utils');

const file = process.argv[2];
const fpsArgIndex = process.argv.indexOf('--fps');
const fps = fpsArgIndex >= 0 ? Number(process.argv[fpsArgIndex + 1]) || 30 : 30;

if (!file) {
  console.error('用法: node detect_timecode.js <media-file> [--fps 30]');
  process.exit(1);
}

try {
  const result = detectEmbeddedTimecode(file, fps);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.hasTimecode ? 0 : 2);
} catch (err) {
  console.error('❌ 读取 timecode 失败:', err.message);
  process.exit(1);
}
