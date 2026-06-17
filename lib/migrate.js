const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const Table = require('cli-table3');

class MigrationManager {
  constructor(database, migrationsDir) {
    this.db = database;
    this.migrationsDir = path.resolve(migrationsDir);
  }

  ensureMigrationsTable() {
    return this.db.runExec(
      `CREATE TABLE IF NOT EXISTS migrations_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        applied_at TEXT
      )`
    );
  }

  async getAppliedMigrations() {
    await this.ensureMigrationsTable();
    return await this.db.runQuery('SELECT name, applied_at FROM migrations_log ORDER BY id');
  }

  getMigrationFiles() {
    if (!fs.existsSync(this.migrationsDir)) {
      fs.mkdirSync(this.migrationsDir, { recursive: true });
      return [];
    }
    return fs.readdirSync(this.migrationsDir)
      .filter(f => f.endsWith('.js'))
      .sort();
  }

  createHelper() {
    const db = this.db;
    return {
      createTable: async (name, columns) => {
        const colDefs = [];
        const constraints = [];
        Object.entries(columns).forEach(([col, def]) => {
          if (col === '_constraints') {
            if (Array.isArray(def)) {
              constraints.push(...def);
            } else {
              constraints.push(def);
            }
          } else {
            colDefs.push(`${col} ${def}`);
          }
        });
        const allDefs = [...colDefs, ...constraints].join(', ');
        await db.runExec(`CREATE TABLE IF NOT EXISTS "${name}" (${allDefs})`);
        await db.loadTableMetadata();
      },
      dropTable: async (name) => {
        await db.runExec(`DROP TABLE IF EXISTS "${name}"`);
        await db.loadTableMetadata();
      },
      addColumn: async (table, column, definition) => {
        await db.runExec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
        await db.loadTableMetadata();
      },
      dropColumn: async (table, column) => {
        await db.runExec(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
        await db.loadTableMetadata();
      },
      addIndex: async (table, columns, name) => {
        const indexName = name || `idx_${table}_${Array.isArray(columns) ? columns.join('_') : columns}`;
        const colList = Array.isArray(columns) ? columns.join(', ') : columns;
        await db.runExec(`CREATE INDEX IF NOT EXISTS "${indexName}" ON "${table}" (${colList})`);
      },
      dropIndex: async (name) => {
        await db.runExec(`DROP INDEX IF EXISTS "${name}"`);
      },
      renameTable: async (oldName, newName) => {
        await db.runExec(`ALTER TABLE "${oldName}" RENAME TO "${newName}"`);
        await db.loadTableMetadata();
      },
      raw: async (sql, params) => {
        if (sql.trim().toUpperCase().startsWith('SELECT')) {
          return await db.runQuery(sql, params || []);
        }
        return await db.runExec(sql, params || []);
      },
      insert: async (table, data) => {
        const columns = Object.keys(data);
        const placeholders = columns.map(() => '?').join(', ');
        const sql = `INSERT INTO "${table}" (${columns.join(', ')}) VALUES (${placeholders})`;
        const params = columns.map(c => data[c]);
        return await db.runExec(sql, params);
      }
    };
  }

  async create(name) {
    if (!fs.existsSync(this.migrationsDir)) {
      fs.mkdirSync(this.migrationsDir, { recursive: true });
    }
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `${timestamp}_${name}.js`;
    const filepath = path.join(this.migrationsDir, filename);
    const content = `exports.up = async function(helper) {\n  \n};\n\nexports.down = async function(helper) {\n  \n};\n`;
    fs.writeFileSync(filepath, content, 'utf8');
    console.log(chalk.green(`✓ 已创建迁移文件: ${filepath}`));
    return filepath;
  }

  async up() {
    await this.ensureMigrationsTable();
    const applied = await this.getAppliedMigrations();
    const appliedNames = new Set(applied.map(r => r.name));
    const files = this.getMigrationFiles();
    const pending = files.filter(f => !appliedNames.has(f));

    if (pending.length === 0) {
      console.log(chalk.yellow('没有待执行的迁移'));
      return 0;
    }

    const helper = this.createHelper();
    let count = 0;

    for (const file of pending) {
      const filepath = path.resolve(this.migrationsDir, file);
      delete require.cache[require.resolve(filepath)];
      const migration = require(filepath);

      try {
        console.log(chalk.cyan(`执行迁移: ${file}`));
        await migration.up(helper);
        await this.db.runExec('INSERT INTO migrations_log (name, applied_at) VALUES (?, ?)', [file, new Date().toISOString()]);
        console.log(chalk.green(`✓ 已应用: ${file}`));
        count++;
      } catch (e) {
        console.log(chalk.red(`✗ 迁移失败: ${file} - ${e.message}`));
        break;
      }
    }

    await this.db.loadTableMetadata();
    return count;
  }

  async down() {
    await this.ensureMigrationsTable();
    const applied = await this.getAppliedMigrations();

    if (applied.length === 0) {
      console.log(chalk.yellow('没有可回滚的迁移'));
      return 0;
    }

    const lastMigration = applied[applied.length - 1];
    const filepath = path.resolve(this.migrationsDir, lastMigration.name);

    if (!fs.existsSync(filepath)) {
      console.log(chalk.red(`迁移文件不存在: ${filepath}`));
      return 0;
    }

    delete require.cache[require.resolve(filepath)];
    const migration = require(filepath);
    const helper = this.createHelper();

    try {
      console.log(chalk.cyan(`回滚迁移: ${lastMigration.name}`));
      await migration.down(helper);
      await this.db.runExec('DELETE FROM migrations_log WHERE name = ?', [lastMigration.name]);
      console.log(chalk.green(`✓ 已回滚: ${lastMigration.name}`));
      await this.db.loadTableMetadata();
      return 1;
    } catch (e) {
      console.log(chalk.red(`✗ 回滚失败: ${e.message}`));
      return 0;
    }
  }

  async status() {
    await this.ensureMigrationsTable();
    const applied = await this.getAppliedMigrations();
    const appliedNames = new Set(applied.map(r => r.name));
    const appliedMap = {};
    applied.forEach(r => { appliedMap[r.name] = r.applied_at; });
    const files = this.getMigrationFiles();

    if (files.length === 0) {
      console.log(chalk.yellow('没有迁移文件'));
      return;
    }

    const table = new Table({
      head: [chalk.cyan('迁移文件'), chalk.cyan('状态'), chalk.cyan('应用时间')],
      style: { head: [], border: [] }
    });

    files.forEach(f => {
      if (appliedNames.has(f)) {
        table.push([f, chalk.green('已应用'), appliedMap[f]]);
      } else {
        table.push([f, chalk.yellow('待执行'), '']);
      }
    });

    console.log(table.toString());
    return { applied: applied.length, total: files.length, pending: files.length - applied.length };
  }
}

module.exports = MigrationManager;
