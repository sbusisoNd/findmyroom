'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

try {
  const lines = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
} catch (e) {
}

const env = process.env;

module.exports = {
  ROOT,
  PORT: Number(env.PORT) || 3000,
  DATA_DIR: env.DATA_DIR || path.join(ROOT, 'data'),
  UPLOAD_DIR: env.UPLOAD_DIR || path.join(ROOT, 'uploads'),
  ADMIN_PASSWORD: env.ADMIN_PASSWORD || 'admin123',

  WHATSAPP_NUMBER: (env.WHATSAPP_NUMBER || '27710000000').replace(/\D/g, ''),
  SUPPORT_EMAIL: env.SUPPORT_EMAIL || 'hello@findmyroom.co.za',
  FACEBOOK_URL: env.FACEBOOK_URL || '#',
  TIKTOK_URL: env.TIKTOK_URL || '#',
  FOUNDER_NAME: env.FOUNDER_NAME || '[Founder Name]',
  SEED_DEMO: String(env.SEED_DEMO || 'true').toLowerCase() !== 'false',
  TRUST_PROXY: env.TRUST_PROXY || '',
};
