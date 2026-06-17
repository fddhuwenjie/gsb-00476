const fs = require('fs');
const path = require('path');

class Storage {
  constructor(dbFilePath) {
    const resolved = path.resolve(dbFilePath);
    const dir = path.dirname(resolved);
    const base = path.basename(resolved);
    this.dataDir = path.join(dir, `${base}.data`);
    this.historyFile = path.join(this.dataDir, 'history.json');
    this.scriptsFile = path.join(this.dataDir, 'scripts.json');
    this.templatesFile = path.join(this.dataDir, 'templates.json');
    this.history = [];
    this.savedScripts = {};
    this.templates = {};
  }

  ensureDir() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  load() {
    this.ensureDir();
    try {
      if (fs.existsSync(this.historyFile)) {
        this.history = JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
      }
    } catch (e) {
      this.history = [];
    }
    try {
      if (fs.existsSync(this.scriptsFile)) {
        this.savedScripts = JSON.parse(fs.readFileSync(this.scriptsFile, 'utf8'));
      }
    } catch (e) {
      this.savedScripts = {};
    }
    try {
      if (fs.existsSync(this.templatesFile)) {
        this.templates = JSON.parse(fs.readFileSync(this.templatesFile, 'utf8'));
      }
    } catch (e) {
      this.templates = {};
    }
  }

  save() {
    this.ensureDir();
    try {
      fs.writeFileSync(this.historyFile, JSON.stringify(this.history.slice(-100), null, 2));
      fs.writeFileSync(this.scriptsFile, JSON.stringify(this.savedScripts, null, 2));
      fs.writeFileSync(this.templatesFile, JSON.stringify(this.templates, null, 2));
    } catch (e) {}
  }

  addHistory(query) {
    this.history.push({ time: new Date().toLocaleTimeString(), query });
    this.save();
  }

  saveScript(name, query) {
    this.savedScripts[name] = {
      query,
      createdAt: new Date().toISOString()
    };
    this.save();
  }

  getScript(name) {
    return this.savedScripts[name];
  }

  saveTemplate(name, query) {
    this.templates[name] = {
      query: query,
      createdAt: new Date().toISOString()
    };
    this.save();
  }

  getTemplate(name) {
    return this.templates[name];
  }

  getDataDirInfo() {
    return {
      dataDir: this.dataDir,
      historyFile: this.historyFile,
      scriptsFile: this.scriptsFile,
      templatesFile: this.templatesFile
    };
  }
}

module.exports = Storage;
