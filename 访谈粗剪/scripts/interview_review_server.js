#!/usr/bin/env node

const path = require('path');
const { spawn } = require('child_process');

const port = process.argv[2] || process.env.PORT || '8899';
const serverScript = path.resolve(__dirname, '..', '..', '剪口播', 'scripts', 'review_server.js');

const child = spawn('node', [serverScript, port], {
  stdio: 'inherit',
  env: {
    ...process.env,
    REVIEW_STATE_FILE: 'interview_review_state.json',
    INTERVIEW_PROJECT_FILE: 'interview_project.json',
  },
});

child.on('exit', code => process.exit(code || 0));
