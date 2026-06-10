#!/usr/bin/env node

const path = require('path');
const {
  applyXmlOffsets,
  ensureManualSyncDefaults,
  readJson,
  writeJson,
} = require('./interview_utils');

const xmlFile = process.argv[2];
const manifestFile = process.argv[3];
const outputFile = process.argv[4] || 'interview_sources.with_xml.json';

if (!xmlFile || !manifestFile) {
  console.error('用法: node import_synced_xml.js <synced.fcpxml|xml> <interview_sources.json> [output.json]');
  process.exit(1);
}

try {
  const baseDir = path.dirname(path.resolve(manifestFile));
  const manifest = ensureManualSyncDefaults({
    ...readJson(manifestFile),
    mode: 'interview',
  });
  const withOffsets = applyXmlOffsets(manifest, path.resolve(baseDir, xmlFile));
  writeJson(outputFile, withOffsets);
  const matched = (withOffsets.sources || []).filter(source => source.syncMethod === 'xml').length;
  console.log(`✅ 已从 XML 导入 offset: ${matched}/${(withOffsets.sources || []).length}`);
  console.log(`📄 输出: ${path.resolve(outputFile)}`);
} catch (err) {
  console.error('❌ XML 导入失败:', err.message);
  process.exit(1);
}
