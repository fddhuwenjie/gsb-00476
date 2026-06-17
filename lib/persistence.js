const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const HISTORY_FILE = 'history.json';
const SCRIPTS_FILE = 'scripts.json';
const TEMPLATES_FILE = 'templates.json';
const META_FILE = 'meta.json';

function getDataDir(dbPath) {
  const resolved = path.resolve(dbPath);
  const dir = path.dirname(resolved);
  const base = path.basename(resolved, path.extname(resolved));
  return path.join(dir, `${base}.data`);
}

function ensureDataDir(dataDir) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

function getFilePath(dataDir, filename) {
  return path.join(dataDir, filename);
}

function readJsonFile(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (e) {
    console.warn(chalk.yellow(`警告: 读取 ${filePath} 失败，使用默认值`));
  }
  return defaultValue;
}

function writeJsonFile(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function loadHistory(dataDir) {
  return readJsonFile(getFilePath(dataDir, HISTORY_FILE), []);
}

function saveHistory(dataDir, history) {
  writeJsonFile(getFilePath(dataDir, HISTORY_FILE), history.slice(-200));
}

function loadScripts(dataDir) {
  return readJsonFile(getFilePath(dataDir, SCRIPTS_FILE), {});
}

function saveScripts(dataDir, scripts) {
  writeJsonFile(getFilePath(dataDir, SCRIPTS_FILE), scripts);
}

function loadTemplates(dataDir) {
  return readJsonFile(getFilePath(dataDir, TEMPLATES_FILE), {});
}

function saveTemplates(dataDir, templates) {
  writeJsonFile(getFilePath(dataDir, TEMPLATES_FILE), templates);
}

function loadMeta(dataDir) {
  return readJsonFile(getFilePath(dataDir, META_FILE), { createdAt: null, lastOpened: null });
}

function saveMeta(dataDir, meta) {
  writeJsonFile(getFilePath(dataDir, META_FILE), { ...meta, lastOpened: new Date().toISOString() });
}

function loadAll(dataDir) {
  ensureDataDir(dataDir);
  const meta = loadMeta(dataDir);
  if (!meta.createdAt) {
    meta.createdAt = new Date().toISOString();
  }
  saveMeta(dataDir, meta);

  return {
    history: loadHistory(dataDir),
    scripts: loadScripts(dataDir),
    templates: loadTemplates(dataDir),
    meta
  };
}

function saveAll(dataDir, data) {
  ensureDataDir(dataDir);
  saveHistory(dataDir, data.history);
  saveScripts(dataDir, data.scripts);
  saveTemplates(dataDir, data.templates);
  saveMeta(dataDir, data.meta || {});
}

function getDataDirInfo(dataDir) {
  const info = {
    path: dataDir,
    exists: fs.existsSync(dataDir),
    files: {}
  };

  if (info.exists) {
    const files = [HISTORY_FILE, SCRIPTS_FILE, TEMPLATES_FILE, META_FILE];
    files.forEach(f => {
      const fp = path.join(dataDir, f);
      if (fs.existsSync(fp)) {
        try {
          const stat = fs.statSync(fp);
          info.files[f] = {
            size: stat.size,
            modified: stat.mtime.toISOString()
          };
        } catch (e) {}
      }
    });
  }

  return info;
}

module.exports = {
  getDataDir,
  ensureDataDir,
  getFilePath,
  readJsonFile,
  writeJsonFile,
  loadHistory,
  saveHistory,
  loadScripts,
  saveScripts,
  loadTemplates,
  saveTemplates,
  loadMeta,
  saveMeta,
  loadAll,
  saveAll,
  getDataDirInfo,
  HISTORY_FILE,
  SCRIPTS_FILE,
  TEMPLATES_FILE,
  META_FILE
};
