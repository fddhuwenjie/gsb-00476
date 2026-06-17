const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

class Database {
  constructor() {
    this.db = null;
    this.dbPath = null;
    this.tableMetadata = {};
    this.foreignKeys = {};
    this.queryLog = [];
    this.inTransaction = false;
  }

  open(filePath) {
    return new Promise((resolve, reject) => {
      const resolved = path.resolve(filePath);
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const isNew = !fs.existsSync(resolved);

      this.db = new sqlite3.Database(resolved, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
        if (err) {
          reject(err);
        } else {
          this.dbPath = resolved;
          this.loadTableMetadata().then(() => {
            if (isNew) {
              console.log(chalk.yellow(`  新建数据库: ${resolved}`));
            } else {
              console.log(chalk.green(`✓ 已连接到数据库: ${resolved}`));
              console.log(chalk.cyan(`  发现 ${Object.keys(this.tableMetadata).length} 个表`));
            }
            resolve({ isNew });
          }).catch(reject);
        }
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        resolve();
      }
    });
  }

  loadTableMetadata() {
    return new Promise((resolve, reject) => {
      this.db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", [], (err, tables) => {
        if (err) return reject(err);

        const promises = tables.map(t => {
          return new Promise((res, rej) => {
            const tableName = t.name;
            this.db.all(`PRAGMA table_info("${tableName}")`, [], (err, columns) => {
              if (err) return rej(err);
              this.tableMetadata[tableName] = columns;

              this.db.all(`PRAGMA foreign_key_list("${tableName}")`, [], (err, fks) => {
                if (err) return rej(err);
                this.foreignKeys[tableName] = fks;
                res();
              });
            });
          });
        });

        Promise.all(promises).then(resolve).catch(reject);
      });
    });
  }

  runQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  runExec(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes, lastID: this.lastID });
      });
    });
  }

  logQuery(sql, params, duration) {
    this.queryLog.push({ sql, params, duration, timestamp: new Date().toISOString() });
  }

  getTableCount(tableName) {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT COUNT(*) as count FROM "${tableName}"`, [], (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.count : 0);
      });
    });
  }

  exists() {
    return this.db !== null;
  }
}

module.exports = Database;
