'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('../config');

for (const f of ['db.json', 'db.json.tmp']) {
  fs.rmSync(path.join(cfg.DATA_DIR, f), { force: true });
}
if (fs.existsSync(cfg.UPLOAD_DIR)) {
  for (const f of fs.readdirSync(cfg.UPLOAD_DIR)) {
    if (f !== '.gitkeep') fs.rmSync(path.join(cfg.UPLOAD_DIR, f), { force: true });
  }
}
console.log('Done. All listings, reports and photos were deleted.');
