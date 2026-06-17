#!/usr/bin/env node

const path = require('path');
const chalk = require('chalk');
const Database = require('./lib/db');
const Storage = require('./lib/storage');
const MigrationManager = require('./lib/migrate');
const REPL = require('./lib/repl');
const { seed } = require('./lib/seed');
const env = require('./lib/env');

const PROJECT_ROOT = __dirname;
const MIGRATIONS_DIR = path.join(PROJECT_ROOT, 'migrations');

function printUsage() {
  console.log(chalk.bold('\nSQLite Query Builder CLI'));
  console.log(chalk.gray('用法: node querybuilder.js <command> [options]'));
  console.log();
  console.log(chalk.cyan('命令:'));
  console.log('  init <dbfile>          初始化数据库（创建 + 执行所有迁移');
  console.log('  open <dbfile>          打开数据库并进入交互式 REPL');
  console.log('  migrate <dbfile> <sub> 数据库迁移 (up|down|status|create <name>');
  console.log('  seed <dbfile>           填充示例数据');
  console.log('  status <dbfile>         查看数据库状态');
  console.log('  help                    显示此帮助信息');
  console.log();
  console.log(chalk.cyan('示例:'));
  console.log('  node querybuilder.js init ecommerce.db');
  console.log('  node querybuilder.js open ecommerce.db');
  console.log('  node querybuilder.js migrate ecommerce.db up');
  console.log('  node querybuilder.js seed ecommerce.db');
  console.log();
}

async function cmdInit(dbFile) {
  if (!env.runAllChecks(PROJECT_ROOT, dbFile, MIGRATIONS_DIR)) {
    process.exit(1);
  }

  const dbInfo = env.checkDbFile(dbFile);
  const db = new Database();
  const storage = new Storage(dbInfo.path);

  console.log();

  if (dbInfo.exists) {
    console.log(chalk.yellow(`⚠ 数据库已存在: ${dbInfo.path}`));
    console.log(chalk.gray('  将尝试执行未完成的迁移...'));
  } else {
    console.log(chalk.cyan(`正在创建数据库: ${dbInfo.path}`));
  }

  const { isNew } = await db.open(dbInfo.path);

  const migrationManager = new MigrationManager(db, MIGRATIONS_DIR);
  const migCount = await migrationManager.up();

  storage.load();

  console.log();
  console.log(chalk.green('✓ 数据库初始化完成!'));
  console.log(`  数据库: ${dbInfo.path}`);
  console.log(`  数据表: ${Object.keys(db.tableMetadata).length} 个表`);
  console.log(`  迁移数: ${migCount} 个新迁移已执行`);
  console.log(`  数据目录: ${storage.dataDir}`);
  console.log();
  console.log(chalk.gray('  下一步: node querybuilder.js open ' + path.basename(dbInfo.path)));
  console.log();

  await db.close();
}

async function cmdOpen(dbFile) {
  if (!env.runAllChecks(PROJECT_ROOT, dbFile, MIGRATIONS_DIR)) {
    process.exit(1);
  }

  const dbInfo = env.checkDbFile(dbFile);
  const db = new Database();
  const storage = new Storage(dbInfo.path);

  await db.open(dbInfo.path);
  storage.load();

  const migrationManager = new MigrationManager(db, MIGRATIONS_DIR);
  const migStatus = await getMigrationStatus(migrationManager);

  env.printStartupBanner(dbInfo, migStatus);

  const repl = new REPL(db, storage, MIGRATIONS_DIR);
  repl.start();
}

async function getMigrationStatus(migrationManager) {
  try {
    const applied = await migrationManager.getAppliedMigrations();
    const files = migrationManager.getMigrationFiles();
    return {
      applied: applied.length,
      total: files.length,
      pending: files.length - applied.length
    };
  } catch (e) {
    return null;
  }
}

async function cmdMigrate(dbFile, subArgs) {
  if (!env.runAllChecks(PROJECT_ROOT, dbFile, MIGRATIONS_DIR)) {
    process.exit(1);
  }

  if (subArgs.length === 0) {
    console.log(chalk.red('用法: node querybuilder.js migrate <dbfile> <up|down|status|create>'));
    process.exit(1);
  }

  const subCmd = subArgs[0];
  const db = new Database();
  const dbInfo = env.checkDbFile(dbFile);

  if (subCmd === 'create') {
    const name = subArgs.slice(1).join('_');
    if (!name) {
      console.log(chalk.red('用法: node querybuilder.js migrate <dbfile> create <名称>'));
      process.exit(1);
    }
    const migrationManager = new MigrationManager(db, MIGRATIONS_DIR);
    await migrationManager.create(name);
    return;
  }

  if (!dbInfo.exists && subCmd !== 'status') {
    console.log(chalk.yellow(`数据库不存在，将创建: ${dbInfo.path}`));
  }

  await db.open(dbInfo.path);

  const migrationManager = new MigrationManager(db, MIGRATIONS_DIR);

  switch (subCmd) {
    case 'up':
      await migrationManager.up();
      break;
    case 'down':
      await migrationManager.down();
      break;
    case 'status':
      await migrationManager.status();
      break;
    default:
      console.log(chalk.red(`未知的迁移子命令: ${subCmd}`));
      console.log(chalk.gray('支持: up, down, status, create <name>'));
      break;
  }

  await db.close();
}

async function cmdSeed(dbFile) {
  if (!env.runAllChecks(PROJECT_ROOT, dbFile, MIGRATIONS_DIR)) {
    process.exit(1);
  }

  const dbInfo = env.checkDbFile(dbFile);
  if (!dbInfo.exists) {
    console.log(chalk.red(`数据库不存在: ${dbInfo.path}`));
    console.log(chalk.yellow('  请先运行: node querybuilder.js init ' + path.basename(dbInfo.path)));
    process.exit(1);
  }

  const db = new Database();
  await db.open(dbInfo.path);

  await seed(db);

  await db.close();
}

async function cmdStatus(dbFile) {
  if (!env.runAllChecks(PROJECT_ROOT, dbFile, MIGRATIONS_DIR)) {
    process.exit(1);
  }

  const dbInfo = env.checkDbFile(dbFile);

  console.log();
  console.log(chalk.bold('数据库状态'));
  console.log('────────────');
  console.log(`  路径: ${dbInfo.path}`);
  console.log(`  存在: ${dbInfo.exists ? chalk.green('是') : chalk.yellow('否')}`);
  if (dbInfo.exists) {
    console.log(`  大小: ${(dbInfo.size / 1024).toFixed(2)} KB`);
  }
  console.log(`  数据目录: ${dbInfo.path}.data/`);

  if (dbInfo.exists) {
    const db = new Database();
    await db.open(dbInfo.path);

    console.log();
    console.log(chalk.bold('表列表:'));
    const tables = Object.keys(db.tableMetadata);
    if (tables.length === 0) {
      console.log(chalk.gray('  (无)'));
    } else {
      for (const t of tables) {
        const count = await db.getTableCount(t);
        console.log(`  ${chalk.cyan(t)} (${count} 行)`);
      }
    }

    console.log();
    const migrationManager = new MigrationManager(db, MIGRATIONS_DIR);
    await migrationManager.status();

    await db.close();
  }

  console.log();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const command = args[0];

  switch (command) {
    case 'init':
      if (args.length < 2) {
        console.log(chalk.red('请指定数据库文件'));
        console.log(chalk.gray('用法: node querybuilder.js init <dbfile>'));
        process.exit(1);
      }
      await cmdInit(args[1]);
      break;

    case 'open':
      if (args.length < 2) {
        console.log(chalk.red('请指定数据库文件'));
        console.log(chalk.gray('用法: node querybuilder.js open <dbfile>'));
        process.exit(1);
      }
      await cmdOpen(args[1]);
      break;

    case 'migrate':
      if (args.length < 2) {
        console.log(chalk.red('请指定数据库文件和迁移子命令'));
        console.log(chalk.gray('用法: node querybuilder.js migrate <dbfile> <up|down|status|create>'));
        process.exit(1);
      }
      await cmdMigrate(args[1], args.slice(2));
      break;

    case 'seed':
      if (args.length < 2) {
        console.log(chalk.red('请指定数据库文件'));
        console.log(chalk.gray('用法: node querybuilder.js seed <dbfile>'));
        process.exit(1);
      }
      await cmdSeed(args[1]);
      break;

    case 'status':
      if (args.length < 2) {
        console.log(chalk.red('请指定数据库文件'));
        console.log(chalk.gray('用法: node querybuilder.js status <dbfile>'));
        process.exit(1);
      }
      await cmdStatus(args[1]);
      break;

    default:
      console.log(chalk.red(`未知命令: ${command}`));
      printUsage();
      process.exit(1);
  }
}

main().catch(err => {
  console.error(chalk.red('\n致命错误:'), err.message);
  console.error(err.stack);
  process.exit(1);
});
