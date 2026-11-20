'use strict';
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

const FILE = path.join(DATA_DIR, 'db.json');
let data = null;

function empty() {
  return {
    meta: { next: { listings: 1, reports: 1, reviews: 1, scams: 1, requests: 1, waiting: 1, notifications: 1 } },
    listings: [],
    reports: [],
    reviews: [],
    scams: [],
    requests: [],
    waiting: [],
    notifications: [],
  };
}

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) {
    data = empty();
    return true;
  }
  try {
    data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    throw new Error('Could not read ' + FILE + ' (' + e.message + '). Fix or delete the file and start again.');
  }
  for (const [k, v] of Object.entries(empty())) if (!(k in data)) data[k] = v;
  return false;
}

function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

function nextId(collection) {
  const n = data.meta.next[collection] || 1;
  data.meta.next[collection] = n + 1;
  return n;
}

module.exports = {
  load,
  save,
  nextId,
  get db() {
    return data;
  },
};
