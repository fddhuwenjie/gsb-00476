const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

let db = null;
let dbPath = null;
let tableMetadata = {};
let foreignKeys = {};
let inTransaction = false;

function getDb() {
  return db;
}

function getDbPath() {
  return dbPath;
}

function getTableMetadata() {
  return tableMetadata;
}

function getForeignKeys() {
  return foreignKeys;
}

function isInTransaction() {
  return inTransaction;
}

function setInTransaction(val) {
  inTransaction = val;
}

function openDatabase(filePath) {
  return new Promise((resolve, reject) => {
    const resolved = path.resolve(filePath);
    db = new sqlite3.Database(resolved, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
      if (err) {
        reject(err);
      } else {
        dbPath = resolved;
        loadTableMetadata().then(resolve).catch(reject);
      }
    });
  });
}

function closeDatabase() {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve();
      return;
    }
    db.close((err) => {
      if (err) reject(err);
      else {
        db = null;
        resolve();
      }
    });
  });
}

function loadTableMetadata() {
  return new Promise((resolve, reject) => {
    tableMetadata = {};
    foreignKeys = {};

    db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", [], (err, tables) => {
      if (err) return reject(err);

      const promises = tables.map(t => {
        return new Promise((res, rej) => {
          const tableName = t.name;
          db.all(`PRAGMA table_info("${tableName}")`, [], (err, columns) => {
            if (err) return rej(err);
            tableMetadata[tableName] = columns;

            db.all(`PRAGMA foreign_key_list("${tableName}")`, [], (err, fks) => {
              if (err) return rej(err);
              foreignKeys[tableName] = fks;
              res();
            });
          });
        });
      });

      Promise.all(promises).then(resolve).catch(reject);
    });
  });
}

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function runExec(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes, lastID: this.lastID });
    });
  });
}

function getDbInfo() {
  return new Promise((resolve, reject) => {
    const info = {
      path: dbPath,
      exists: fs.existsSync(dbPath),
      size: 0,
      tableCount: Object.keys(tableMetadata).length,
      tables: []
    };

    if (info.exists) {
      try {
        const stat = fs.statSync(dbPath);
        info.size = stat.size;
      } catch (e) {}
    }

    const tableNames = Object.keys(tableMetadata);
    let done = 0;

    if (tableNames.length === 0) {
      resolve(info);
      return;
    }

    tableNames.forEach(name => {
      db.get(`SELECT COUNT(*) as cnt FROM "${name}"`, [], (err, row) => {
        if (!err) {
          info.tables.push({
            name,
            columns: tableMetadata[name].length,
            rows: row.cnt
          });
        }
        done++;
        if (done === tableNames.length) {
          info.tables.sort((a, b) => a.name.localeCompare(b.name));
          resolve(info);
        }
      });
    });
  });
}

function printDbInfo(info) {
  console.log(chalk.bold('\n数据库信息:'));
  console.log(`  路径: ${chalk.cyan(info.path)}`);
  console.log(`  大小: ${chalk.cyan(formatSize(info.size))}`);
  console.log(`  表数量: ${chalk.cyan(info.tableCount)}`);

  if (info.tables.length > 0) {
    console.log(chalk.bold('\n  表列表:'));
    info.tables.forEach(t => {
      console.log(`    ${chalk.cyan(t.name)} (${t.columns} 列, ${t.rows} 行)`);
    });
  }
  console.log();
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

module.exports = {
  getDb,
  getDbPath,
  getTableMetadata,
  getForeignKeys,
  isInTransaction,
  setInTransaction,
  openDatabase,
  closeDatabase,
  loadTableMetadata,
  runQuery,
  runExec,
  getDbInfo,
  printDbInfo,
  formatSize
};
