const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const Table = require('cli-table3');
const dbModule = require('./db');

let migrationsDir = 'migrations';

function setMigrationsDir(dir) {
  migrationsDir = path.resolve(dir);
}

function getMigrationsDir() {
  return migrationsDir;
}

function ensureMigrationsTable() {
  return dbModule.runExec(
    `CREATE TABLE IF NOT EXISTS migrations_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      applied_at TEXT
    )`
  );
}

function getAppliedMigrations() {
  return ensureMigrationsTable().then(() =>
    dbModule.runQuery('SELECT name, applied_at FROM migrations_log ORDER BY id')
  );
}

function getMigrationFiles() {
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
    return [];
  }
  return fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.js'))
    .sort();
}

function createMigrationHelper() {
  return {
    createTable: async (name, columns) => {
      const cols = Object.entries(columns).map(([col, def]) => `${col} ${def}`).join(', ');
      await dbModule.runExec(`CREATE TABLE IF NOT EXISTS "${name}" (${cols})`);
      await dbModule.loadTableMetadata();
    },
    dropTable: async (name) => {
      await dbModule.runExec(`DROP TABLE IF EXISTS "${name}"`);
      await dbModule.loadTableMetadata();
    },
    addColumn: async (table, column, definition) => {
      await dbModule.runExec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
      await dbModule.loadTableMetadata();
    },
    dropColumn: async (table, column) => {
      await dbModule.runExec(`ALTER TABLE "${table}" DROP COLUMN "${column}"`);
      await dbModule.loadTableMetadata();
    },
    addIndex: async (table, columns, name) => {
      const indexName = name || `idx_${table}_${Array.isArray(columns) ? columns.join('_') : columns}`;
      const colList = Array.isArray(columns) ? columns.join(', ') : columns;
      await dbModule.runExec(`CREATE INDEX IF NOT EXISTS "${indexName}" ON "${table}" (${colList})`);
    },
    dropIndex: async (name) => {
      await dbModule.runExec(`DROP INDEX IF EXISTS "${name}"`);
    },
    renameTable: async (oldName, newName) => {
      await dbModule.runExec(`ALTER TABLE "${oldName}" RENAME TO "${newName}"`);
      await dbModule.loadTableMetadata();
    },
    raw: async (sql, params) => {
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        return await dbModule.runQuery(sql, params || []);
      }
      return await dbModule.runExec(sql, params || []);
    }
  };
}

async function migrateCreate(name) {
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const filename = `${timestamp}_${name}.js`;
  const filepath = path.join(migrationsDir, filename);
  const content = `exports.up = async function(helper) {
  // 使用 helper.createTable / helper.raw 等方法
  // 例如: await helper.createTable('users', { id: 'INTEGER PRIMARY KEY AUTOINCREMENT', name: 'TEXT NOT NULL' });
};

exports.down = async function(helper) {
  // 回滚逻辑，与 up 相反
  // 例如: await helper.dropTable('users');
};
`;
  fs.writeFileSync(filepath, content, 'utf8');
  console.log(chalk.green(`✓ 已创建迁移文件: ${filepath}`));
  return filepath;
}

async function migrateUp() {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();
  const appliedNames = new Set(applied.map(r => r.name));
  const files = getMigrationFiles();
  const pending = files.filter(f => !appliedNames.has(f));

  if (pending.length === 0) {
    console.log(chalk.yellow('没有待执行的迁移'));
    return { count: 0, files: [] };
  }

  const helper = createMigrationHelper();
  const appliedFiles = [];

  for (const file of pending) {
    const filepath = path.resolve(migrationsDir, file);
    delete require.cache[require.resolve(filepath)];
    const migration = require(filepath);

    try {
      console.log(chalk.cyan(`  执行迁移: ${file}`));
      await migration.up(helper);
      await dbModule.runExec('INSERT INTO migrations_log (name, applied_at) VALUES (?, ?)', [file, new Date().toISOString()]);
      console.log(chalk.green(`  ✓ 已应用: ${file}`));
      appliedFiles.push(file);
    } catch (e) {
      console.log(chalk.red(`  ✗ 迁移失败: ${file} - ${e.message}`));
      break;
    }
  }

  await dbModule.loadTableMetadata();
  return { count: appliedFiles.length, files: appliedFiles };
}

async function migrateDown() {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  if (applied.length === 0) {
    console.log(chalk.yellow('没有可回滚的迁移'));
    return { count: 0, file: null };
  }

  const lastMigration = applied[applied.length - 1];
  const filepath = path.resolve(migrationsDir, lastMigration.name);

  if (!fs.existsSync(filepath)) {
    console.log(chalk.red(`迁移文件不存在: ${filepath}`));
    return { count: 0, file: null, error: 'file not found' };
  }

  delete require.cache[require.resolve(filepath)];
  const migration = require(filepath);
  const helper = createMigrationHelper();

  try {
    console.log(chalk.cyan(`  回滚迁移: ${lastMigration.name}`));
    await migration.down(helper);
    await dbModule.runExec('DELETE FROM migrations_log WHERE name = ?', [lastMigration.name]);
    console.log(chalk.green(`  ✓ 已回滚: ${lastMigration.name}`));
    await dbModule.loadTableMetadata();
    return { count: 1, file: lastMigration.name };
  } catch (e) {
    console.log(chalk.red(`  ✗ 回滚失败: ${e.message}`));
    return { count: 0, file: lastMigration.name, error: e.message };
  }
}

async function migrateStatus() {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();
  const appliedNames = new Set(applied.map(r => r.name));
  const appliedMap = {};
  applied.forEach(r => { appliedMap[r.name] = r.applied_at; });
  const files = getMigrationFiles();

  return {
    total: files.length,
    applied: applied.length,
    pending: files.length - applied.length,
    files: files.map(f => ({
      name: f,
      status: appliedNames.has(f) ? 'applied' : 'pending',
      appliedAt: appliedMap[f] || null
    }))
  };
}

function printMigrateStatus(status) {
  if (status.files.length === 0) {
    console.log(chalk.yellow('没有迁移文件'));
    return;
  }

  const table = new Table({
    head: [chalk.cyan('迁移文件'), chalk.cyan('状态'), chalk.cyan('应用时间')],
    style: { head: [], border: [] }
  });

  status.files.forEach(f => {
    if (f.status === 'applied') {
      table.push([f.name, chalk.green('已应用'), f.appliedAt || '']);
    } else {
      table.push([f.name, chalk.yellow('待执行'), '']);
    }
  });

  console.log(table.toString());
  console.log(chalk.gray(`总计: ${status.total} 个迁移, 已应用 ${status.applied} 个, 待执行 ${status.pending} 个`));
}

module.exports = {
  setMigrationsDir,
  getMigrationsDir,
  ensureMigrationsTable,
  getAppliedMigrations,
  getMigrationFiles,
  createMigrationHelper,
  migrateCreate,
  migrateUp,
  migrateDown,
  migrateStatus,
  printMigrateStatus
};
