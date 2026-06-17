const readline = require('readline');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const env = require('./lib/env');
const dbModule = require('./lib/db');
const persistence = require('./lib/persistence');
const migrations = require('./lib/migrations');
const queryLib = require('./lib/query');

const { createDbProxy, printTable, printTableInfo, showSlowQueries,
        explainQuery, suggestIndexes, generateSchema, generateDoc } = queryLib;

let dataDir = null;
let history = [];
let savedScripts = {};
let templates = {};
let dbProxy = null;

function loadPersistentState() {
  const data = persistence.loadAll(dataDir);
  history = data.history;
  savedScripts = data.scripts;
  templates = data.templates;
}

function savePersistentState() {
  persistence.saveAll(dataDir, {
    history,
    scripts: savedScripts,
    templates,
    meta: { lastOpened: new Date().toISOString() }
  });
}

function addHistory(query) {
  history.push({ time: new Date().toLocaleTimeString(), query });
  if (history.length > 200) {
    history = history.slice(-200);
  }
  savePersistentState();
}

function resolveTemplate(name, visited) {
  if (!visited) visited = new Set();
  if (visited.has(name)) throw new Error(`循环引用模板: ${name}`);
  visited.add(name);

  const tmpl = templates[name];
  if (!tmpl) throw new Error(`模板 '${name}' 不存在`);

  let query = tmpl.query;
  query = query.replace(/\{\{(\w+)\}\}/g, function(match, refName) {
    return resolveTemplate(refName, new Set(visited));
  });

  return query;
}

function extractParams(query) {
  const params = [];
  const regex = /:(\w+)/g;
  let match;
  while ((match = regex.exec(query)) !== null) {
    if (!params.includes(match[1])) {
      params.push(match[1]);
    }
  }
  return params;
}

function templateCreate(name, query) {
  templates[name] = {
    query: query,
    createdAt: new Date().toISOString()
  };
  savePersistentState();
  console.log(chalk.green(`✓ 模板 '${name}' 已创建`));
  const params = extractParams(query);
  if (params.length > 0) {
    console.log(chalk.gray(`  参数: ${params.map(p => ':' + p).join(', ')}`));
  }
}

async function templateRun(name, paramStr) {
  let query = resolveTemplate(name);

  const params = {};
  if (paramStr) {
    paramStr.split(/\s+/).forEach(p => {
      const eqIdx = p.indexOf('=');
      if (eqIdx > 0 && p.startsWith('--')) {
        const key = p.slice(2, eqIdx);
        const value = p.slice(eqIdx + 1);
        params[key] = value;
      }
    });
  }

  Object.entries(params).forEach(([key, value]) => {
    query = query.replace(new RegExp(`:${key}\\b`, 'g'), value);
  });

  console.log(chalk.cyan(`解析后的查询: ${query}`));
  await executeCommand(query);
}

function templateList() {
  const Table = require('cli-table3');
  const names = Object.keys(templates);
  if (names.length === 0) {
    console.log(chalk.yellow('暂无保存的模板'));
    return;
  }

  const table = new Table({
    head: [chalk.cyan('名称'), chalk.cyan('查询'), chalk.cyan('参数')],
    style: { head: [], border: [] }
  });

  names.forEach(name => {
    const params = extractParams(templates[name].query);
    const queryStr = templates[name].query;
    table.push([
      name,
      queryStr.length > 50 ? queryStr.slice(0, 50) + '...' : queryStr,
      params.length > 0 ? params.map(p => ':' + p).join(', ') : '(无)'
    ]);
  });

  console.log(table.toString());
}

async function evaluateQuery(queryStr) {
  try {
    const trimmed = queryStr.trim().replace(/;+$/, '');
    const result = await eval(`(async function(db, console) { return ${trimmed}; })(dbProxy, console)`);
    return result;
  } catch (e) {
    console.log(chalk.red(`错误: ${e.message}`));
    return null;
  }
}

async function executeCommand(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  if (trimmed === 'exit' || trimmed === 'quit' || trimmed === '.exit') {
    console.log(chalk.yellow('再见!'));
    savePersistentState();
    process.exit(0);
  }

  if (trimmed === 'help' || trimmed === '.help') {
    printHelp();
    return;
  }

  if (trimmed === 'tables') {
    const tableMetadata = dbModule.getTableMetadata();
    const tables = Object.keys(tableMetadata);
    console.log(chalk.bold('\n数据库中的表:'));
    tables.forEach(t => {
      const count = tableMetadata[t].length;
      console.log(`  ${chalk.cyan(t)} (${count} 列)`);
    });
    console.log();
    return;
  }

  if (trimmed.startsWith('describe ')) {
    const tableName = trimmed.slice(9).trim();
    printTableInfo(tableName);
    return;
  }

  if (trimmed.startsWith('sample ')) {
    const tableName = trimmed.slice(7).trim();
    const tableMetadata = dbModule.getTableMetadata();
    if (!tableMetadata[tableName]) {
      console.log(chalk.red(`表 '${tableName}' 不存在`));
      return;
    }
    const sql = `SELECT * FROM "${tableName}" LIMIT 10`;
    console.log(chalk.blue(`\n生成的 SQL: ${sql}`));
    const rows = await dbModule.runQuery(sql);
    console.log(chalk.green('\n✓ 查询成功'));
    printTable(rows);
    return;
  }

  if (trimmed.startsWith('count ')) {
    const tableName = trimmed.slice(6).trim();
    const tableMetadata = dbModule.getTableMetadata();
    if (!tableMetadata[tableName]) {
      console.log(chalk.red(`表 '${tableName}' 不存在`));
      return;
    }
    const sql = `SELECT COUNT(*) as count FROM "${tableName}"`;
    console.log(chalk.blue(`\n生成的 SQL: ${sql}`));
    const rows = await dbModule.runQuery(sql);
    console.log(chalk.green(`\n✓ 表 '${tableName}' 共有 ${rows[0].count} 行数据`));
    return;
  }

  if (trimmed === 'history') {
    console.log(chalk.bold('\n查询历史:'));
    history.forEach((h, i) => {
      console.log(`  ${i + 1}. [${h.time}] ${chalk.gray(h.query)}`);
    });
    console.log();
    return;
  }

  if (trimmed.startsWith('save ')) {
    const parts = trimmed.slice(5).trim().split(/\s+/);
    const name = parts[0];
    const query = parts.slice(1).join(' ');
    if (!name || !query) {
      console.log(chalk.red('用法: save <名称> <查询语句>'));
      return;
    }
    savedScripts[name] = {
      query,
      createdAt: new Date().toISOString()
    };
    savePersistentState();
    console.log(chalk.green(`✓ 脚本 '${name}' 已保存`));
    return;
  }

  if (trimmed.startsWith('run ')) {
    const name = trimmed.slice(4).trim();
    const script = savedScripts[name];
    if (!script) {
      console.log(chalk.red(`脚本 '${name}' 不存在`));
      return;
    }
    console.log(chalk.cyan(`执行脚本 '${name}': ${script.query}`));
    await executeCommand(script.query);
    return;
  }

  if (trimmed === 'scripts' || trimmed === 'ls scripts') {
    console.log(chalk.bold('\n已保存的脚本:'));
    Object.keys(savedScripts).forEach(name => {
      const s = savedScripts[name];
      console.log(`  ${chalk.cyan(name)}: ${s.query}`);
    });
    if (Object.keys(savedScripts).length === 0) {
      console.log(chalk.gray('  (暂无保存的脚本)'));
    }
    console.log();
    return;
  }

  if (trimmed.startsWith('.read ')) {
    const filePath = trimmed.slice(6).trim();
    if (!fs.existsSync(filePath)) {
      console.log(chalk.red(`文件不存在: ${filePath}`));
      return;
    }
    const content = fs.readFileSync(filePath, 'utf8');

    if (filePath.endsWith('.js')) {
      console.log(chalk.cyan(`执行 JavaScript 文件: ${filePath}`));
      eval(content);
    } else {
      console.log(chalk.cyan(`执行 SQL 文件: ${filePath}`));
      const statements = content.split(';').filter(s => s.trim());
      for (const stmt of statements) {
        console.log(chalk.blue(`\nSQL: ${stmt.trim()}`));
        try {
          const rows = await dbModule.runQuery(stmt.trim());
          if (rows.length > 0) {
            printTable(rows);
          } else {
            console.log(chalk.green('  ✓ 执行成功'));
          }
        } catch (e) {
          console.log(chalk.red(`  ✗ 错误: ${e.message}`));
        }
      }
    }
    return;
  }

  if (trimmed.startsWith('export ')) {
    const parts = trimmed.slice(7).trim().split(/\s+/);
    if (parts.length < 2) {
      console.log(chalk.red('用法: export <格式> <文件名> <查询语句>'));
      console.log(chalk.gray('  格式支持: csv, json, md'));
      return;
    }
    const format = parts[0].toLowerCase();
    const filename = parts[1];
    const query = parts.slice(2).join(' ');

    const result = await evaluateQuery(query);
    if (result && result.rows) {
      // handled by export method on QueryBuilder
    } else if (result && Array.isArray(result)) {
      const qb = { export: () => {} };
    }
    return;
  }

  if (trimmed.startsWith('migrate ')) {
    const sub = trimmed.slice(8).trim();
    if (sub.startsWith('create ')) {
      const name = sub.slice(7).trim();
      if (!name) {
        console.log(chalk.red('用法: migrate create <名称>'));
        return;
      }
      await migrations.migrateCreate(name);
    } else if (sub === 'up') {
      await migrations.migrateUp();
    } else if (sub === 'down') {
      await migrations.migrateDown();
    } else if (sub === 'status') {
      const status = await migrations.migrateStatus();
      migrations.printMigrateStatus(status);
    } else {
      console.log(chalk.red('用法: migrate create <名称> | migrate up | migrate down | migrate status'));
    }
    return;
  }

  if (trimmed.startsWith('explain ')) {
    const queryStr = trimmed.slice(8).trim();
    await explainQuery(queryStr);
    return;
  }

  if (trimmed === 'suggest') {
    await suggestIndexes();
    return;
  }

  if (trimmed.startsWith('slow')) {
    const parts = trimmed.slice(4).trim();
    showSlowQueries(parts || '100');
    return;
  }

  if (trimmed === 'begin') {
    if (dbModule.isInTransaction()) {
      console.log(chalk.yellow('已在事务中'));
      return;
    }
    try {
      await dbModule.runExec('BEGIN TRANSACTION');
      dbModule.setInTransaction(true);
      console.log(chalk.green('✓ 事务已开始'));
    } catch (e) {
      console.log(chalk.red(`错误: ${e.message}`));
    }
    return;
  }

  if (trimmed === 'commit') {
    if (!dbModule.isInTransaction()) {
      console.log(chalk.yellow('没有活动的事务'));
      return;
    }
    try {
      await dbModule.runExec('COMMIT');
      dbModule.setInTransaction(false);
      console.log(chalk.green('✓ 事务已提交'));
    } catch (e) {
      console.log(chalk.red(`错误: ${e.message}`));
    }
    return;
  }

  if (trimmed === 'rollback') {
    if (!dbModule.isInTransaction()) {
      console.log(chalk.yellow('没有活动的事务'));
      return;
    }
    try {
      await dbModule.runExec('ROLLBACK');
      dbModule.setInTransaction(false);
      console.log(chalk.green('✓ 事务已回滚'));
    } catch (e) {
      console.log(chalk.red(`错误: ${e.message}`));
    }
    return;
  }

  if (trimmed.startsWith('batch ')) {
    const batchStr = trimmed.slice(6).trim();
    let queries;
    try {
      queries = eval(batchStr);
    } catch (e) {
      console.log(chalk.red(`解析批量查询失败: ${e.message}`));
      return;
    }
    if (!Array.isArray(queries) || queries.length === 0) {
      console.log(chalk.red('batch 需要查询字符串数组'));
      return;
    }
    try {
      await dbModule.runExec('BEGIN TRANSACTION');
      dbModule.setInTransaction(true);
      for (let i = 0; i < queries.length; i++) {
        try {
          console.log(chalk.cyan(`\n[${i + 1}/${queries.length}] ${queries[i]}`));
          await evaluateQuery(queries[i]);
        } catch (e) {
          await dbModule.runExec('ROLLBACK');
          dbModule.setInTransaction(false);
          console.log(chalk.red(`\n✗ 批量操作在第 ${i + 1} 条失败: ${e.message}`));
          console.log(chalk.yellow('所有操作已回滚'));
          return;
        }
      }
      await dbModule.runExec('COMMIT');
      dbModule.setInTransaction(false);
      console.log(chalk.green(`\n✓ 批量操作成功 (${queries.length} 条)`));
    } catch (e) {
      console.log(chalk.red(`批量操作错误: ${e.message}`));
      try {
        if (dbModule.isInTransaction()) {
          await dbModule.runExec('ROLLBACK');
          dbModule.setInTransaction(false);
        }
      } catch (e2) {}
    }
    return;
  }

  if (trimmed.startsWith('schema')) {
    const rest = trimmed.slice(6).trim();
    let outputFile = null;
    const oMatch = rest.match(/-o\s+(\S+)/);
    if (oMatch) {
      outputFile = oMatch[1];
    }
    await generateSchema(outputFile);
    return;
  }

  if (trimmed.startsWith('doc')) {
    const rest = trimmed.slice(3).trim();
    let outputFile = null;
    const oMatch = rest.match(/-o\s+(\S+)/);
    if (oMatch) {
      outputFile = oMatch[1];
    }
    await generateDoc(outputFile);
    return;
  }

  if (trimmed.startsWith('template ')) {
    const sub = trimmed.slice(9).trim();
    if (sub.startsWith('create ')) {
      const parts = sub.slice(7).trim();
      const spaceIdx = parts.indexOf(' ');
      if (spaceIdx < 0) {
        console.log(chalk.red('用法: template create <名称> <查询>'));
        return;
      }
      const name = parts.slice(0, spaceIdx);
      const query = parts.slice(spaceIdx + 1);
      templateCreate(name, query);
    } else if (sub.startsWith('run ')) {
      const rest = sub.slice(4).trim();
      const spaceIdx = rest.indexOf(' ');
      let name, paramStr;
      if (spaceIdx < 0) {
        name = rest;
        paramStr = '';
      } else {
        name = rest.slice(0, spaceIdx);
        paramStr = rest.slice(spaceIdx + 1);
      }
      await templateRun(name, paramStr);
    } else if (sub === 'list') {
      templateList();
    } else {
      console.log(chalk.red('用法: template create <名称> <查询> | template run <名称> [--param=value...] | template list'));
    }
    return;
  }

  if (trimmed === 'info' || trimmed === 'status') {
    const info = await dbModule.getDbInfo();
    dbModule.printDbInfo(info);
    const dataInfo = persistence.getDataDirInfo(dataDir);
    console.log(chalk.bold('数据目录:'));
    console.log(`  路径: ${chalk.cyan(dataInfo.path)}`);
    console.log(`  历史记录: ${chalk.cyan(history.length)} 条`);
    console.log(`  保存脚本: ${chalk.cyan(Object.keys(savedScripts).length)} 个`);
    console.log(`  查询模板: ${chalk.cyan(Object.keys(templates).length)} 个`);
    console.log();
    const migStatus = await migrations.migrateStatus();
    console.log(chalk.bold('迁移状态:'));
    console.log(`  已应用: ${chalk.cyan(migStatus.applied)} 个`);
    console.log(`  待执行: ${chalk.cyan(migStatus.pending)} 个`);
    console.log();
    return;
  }

  if (trimmed.startsWith('db.') || trimmed.startsWith('db[')) {
    addHistory(trimmed);
    await evaluateQuery(trimmed);
    return;
  }

  try {
    addHistory(trimmed);
    console.log(chalk.blue(`\nSQL: ${trimmed}`));
    const rows = await dbModule.runQuery(trimmed);
    printTable(rows);
  } catch (e) {
    console.log(chalk.red(`错误: ${e.message}`));
  }
}

function printHelp() {
  console.log(chalk.bold('\n可用命令:'));
  console.log(chalk.cyan('\n数据库探索:'));
  console.log('  tables              - 列出所有表');
  console.log('  describe <table>    - 显示表结构');
  console.log('  sample <table>      - 显示前10行数据');
  console.log('  count <table>       - 显示行数');
  console.log('  info / status       - 显示数据库和数据目录状态');

  console.log(chalk.cyan('\n链式查询示例:'));
  console.log('  db.users.where("age > ?", 25).select("name", "email").orderBy("name").limit(10)');
  console.log('  db.orders.join("users").select("users.name", "orders.total").limit(5)');
  console.log('  db.orders.groupBy("status").count().sum("total").avg("total")');

  console.log(chalk.cyan('\n数据操作:'));
  console.log('  db.users.insert({name: "张三", age: 30})');
  console.log('  db.users.where("id = ?", 1).update({age: 31})');
  console.log('  db.users.where("id = ?", 1).delete()');
  console.log('  db.users.upsert({email: "x@x.com"}, {name: "新名字"})');
  console.log('  db.users.bulkInsert([{name: "A"}, {name: "B"}])');

  console.log(chalk.cyan('\n数据库迁移:'));
  console.log('  migrate create <name>  - 创建迁移文件');
  console.log('  migrate up             - 执行待运行的迁移');
  console.log('  migrate down           - 回滚最后一次迁移');
  console.log('  migrate status         - 查看迁移状态');

  console.log(chalk.cyan('\n查询分析与优化:'));
  console.log('  explain <chain-query>  - 查看查询执行计划');
  console.log('  suggest                - 建议缺失的索引');
  console.log('  slow [threshold]       - 显示慢查询 (默认100ms)');

  console.log(chalk.cyan('\n事务与批量操作:'));
  console.log('  begin                  - 开始事务');
  console.log('  commit                 - 提交事务');
  console.log('  rollback               - 回滚事务');
  console.log('  batch [query1, ...]    - 批量执行 (原子操作)');

  console.log(chalk.cyan('\nER图与文档:'));
  console.log('  schema [-o file.dot]   - 生成ER图 (DOT格式)');
  console.log('  doc [-o file.md]       - 生成数据库文档 (Markdown)');

  console.log(chalk.cyan('\n查询模板:'));
  console.log('  template create <name> <query>          - 创建参数化模板 (:param)');
  console.log('  template run <name> --param1=val1 ...   - 执行模板');
  console.log('  template list                            - 列出所有模板');

  console.log(chalk.cyan('\n导出与脚本:'));
  console.log('  save <name> <query>                   - 保存脚本');
  console.log('  run <name>                            - 执行脚本');
  console.log('  scripts                               - 列出保存的脚本');
  console.log('  history                               - 显示历史查询');
  console.log('  .read <file>                          - 批量执行文件(.sql或.js)');

  console.log(chalk.cyan('\n其他:'));
  console.log('  help                  - 显示帮助');
  console.log('  exit                  - 退出程序');
  console.log();
}

function startREPL() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green('db> ')
  });

  console.log(chalk.bold('\n╔════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold('║          SQLite 查询构建器 CLI - 交互式 REPL             ║'));
  console.log(chalk.bold('╚════════════════════════════════════════════════════════════╝'));
  console.log(chalk.gray('输入 help 查看帮助, exit 退出'));
  console.log();

  rl.prompt();

  rl.on('line', async (line) => {
    try {
      await executeCommand(line);
    } catch (e) {
      console.log(chalk.red(`错误: ${e.message}`));
    }
    rl.prompt();
  });

  rl.on('close', () => {
    console.log(chalk.yellow('\n再见!'));
    savePersistentState();
    process.exit(0);
  });
}

async function cmdInit(dbFile, options = {}) {
  const dbPath = path.resolve(dbFile);
  const dbDir = path.dirname(dbPath);

  if (fs.existsSync(dbPath) && !options.force) {
    console.log(chalk.red(`数据库已存在: ${dbPath}`));
    console.log(chalk.yellow('使用 --force 覆盖或使用 open 命令打开现有数据库'));
    process.exit(1);
  }

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  console.log(chalk.cyan(`初始化数据库: ${dbPath}`));

  await dbModule.openDatabase(dbPath);

  dataDir = persistence.getDataDir(dbPath);
  persistence.ensureDataDir(dataDir);

  const checkResult = env.runStartupChecks(dataDir);
  env.printCheckResults(checkResult.results);

  if (!checkResult.ok) {
    console.log(chalk.red('环境检查未通过，请修复上述问题后重试'));
    process.exit(1);
  }

  loadPersistentState();
  dbProxy = createDbProxy();

  const migrationsDir = path.resolve(__dirname, 'migrations');
  migrations.setMigrationsDir(migrationsDir);

  if (options.migrate) {
    console.log(chalk.cyan('执行迁移...'));
    const result = await migrations.migrateUp();
    if (result.count > 0) {
      console.log(chalk.green(`✓ 已执行 ${result.count} 个迁移`));
    }
  }

  if (options.seed) {
    console.log(chalk.cyan('填充种子数据...'));
    const seedPath = path.resolve(__dirname, 'seed.js');
    if (fs.existsSync(seedPath)) {
      const seed = require(seedPath);
      if (typeof seed.run === 'function') {
        await seed.run(dbModule.getDb());
        await dbModule.loadTableMetadata();
        console.log(chalk.green('✓ 种子数据填充完成'));
      } else {
        console.log(chalk.yellow('seed.js 未导出 run 函数，跳过种子数据'));
      }
    } else {
      console.log(chalk.yellow('未找到 seed.js，跳过种子数据'));
    }
  }

  const info = await dbModule.getDbInfo();
  dbModule.printDbInfo(info);

  console.log(chalk.green(`✓ 数据库初始化完成`));
  console.log(chalk.gray(`数据目录: ${dataDir}`));

  await dbModule.closeDatabase();
}

async function cmdOpen(dbFile) {
  const dbPath = path.resolve(dbFile);
  const dbDir = path.dirname(dbPath);
  const isNew = !fs.existsSync(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  dataDir = persistence.getDataDir(dbPath);
  persistence.ensureDataDir(dataDir);

  const checkResult = env.runStartupChecks(dataDir);
  env.printCheckResults(checkResult.results);

  if (!checkResult.ok) {
    console.log(chalk.red('环境检查未通过，请修复上述问题后重试'));
    process.exit(1);
  }

  try {
    await dbModule.openDatabase(dbPath);
  } catch (e) {
    console.log(chalk.red(`无法打开数据库: ${e.message}`));
    process.exit(1);
  }

  loadPersistentState();
  dbProxy = createDbProxy();

  const migrationsDir = path.resolve(__dirname, 'migrations');
  migrations.setMigrationsDir(migrationsDir);

  if (isNew) {
    console.log(chalk.yellow('提示: 这是一个新数据库'));
    console.log(chalk.gray('  运行 migrate up 执行待处理的迁移'));
    console.log();
  }

  const info = await dbModule.getDbInfo();
  dbModule.printDbInfo(info);

  const dataInfo = persistence.getDataDirInfo(dataDir);
  console.log(chalk.bold('数据目录:'));
  console.log(`  路径: ${chalk.cyan(dataInfo.path)}`);
  console.log(`  历史记录: ${chalk.cyan(history.length)} 条`);
  console.log(`  保存脚本: ${chalk.cyan(Object.keys(savedScripts).length)} 个`);
  console.log(`  查询模板: ${chalk.cyan(Object.keys(templates).length)} 个`);
  console.log();

  const migStatus = await migrations.migrateStatus();
  if (migStatus.pending > 0) {
    console.log(chalk.yellow(`注意: 有 ${migStatus.pending} 个待执行的迁移，运行 'migrate up' 应用它们`));
    console.log();
  }

  startREPL();
}

async function cmdMigrate(dbFile, subCmd, migrationName) {
  const dbPath = path.resolve(dbFile);

  if (!fs.existsSync(dbPath) && subCmd !== 'create') {
    console.log(chalk.red(`数据库不存在: ${dbPath}`));
    process.exit(1);
  }

  const migrationsDir = path.resolve(__dirname, 'migrations');
  migrations.setMigrationsDir(migrationsDir);

  if (subCmd === 'create') {
    if (!migrationName) {
      console.log(chalk.red('请指定迁移名称'));
      console.log(chalk.gray('用法: node querybuilder.js migrate create <名称> [dbfile]'));
      process.exit(1);
    }
    await migrations.migrateCreate(migrationName);
    return;
  }

  await dbModule.openDatabase(dbPath);

  switch (subCmd) {
    case 'up':
      const upResult = await migrations.migrateUp();
      if (upResult.count > 0) {
        console.log(chalk.green(`\n✓ 成功执行 ${upResult.count} 个迁移`));
      }
      break;
    case 'down':
      const downResult = await migrations.migrateDown();
      if (downResult.count > 0) {
        console.log(chalk.green(`\n✓ 成功回滚 1 个迁移`));
      }
      break;
    case 'status':
      const status = await migrations.migrateStatus();
      migrations.printMigrateStatus(status);
      break;
    default:
      console.log(chalk.red('未知迁移命令'));
      console.log(chalk.gray('可用命令: create, up, down, status'));
      process.exit(1);
  }

  await dbModule.closeDatabase();
}

function printUsage() {
  console.log(chalk.bold('\nSQLite 查询构建器 CLI'));
  console.log(chalk.gray('基于 SQLite 的交互式查询构建工具'));
  console.log();
  console.log(chalk.bold('用法:'));
  console.log('  node querybuilder.js <command> [options]');
  console.log();
  console.log(chalk.bold('命令:'));
  console.log(chalk.cyan('  init <dbfile>') + '       初始化新数据库');
  console.log('    --migrate              初始化后执行所有迁移');
  console.log('    --seed                 初始化后填充种子数据');
  console.log('    --force                覆盖已存在的数据库');
  console.log();
  console.log(chalk.cyan('  open <dbfile>') + '       打开数据库并进入交互模式');
  console.log();
  console.log(chalk.cyan('  migrate') + '             数据库迁移管理');
  console.log('    create <name> [dbfile] 创建新迁移文件');
  console.log('    up <dbfile>           执行待处理的迁移');
  console.log('    down <dbfile>         回滚最后一个迁移');
  console.log('    status <dbfile>       查看迁移状态');
  console.log();
  console.log(chalk.cyan('  help') + '                显示此帮助信息');
  console.log();
  console.log(chalk.bold('示例:'));
  console.log('  node querybuilder.js init ecommerce.db --migrate --seed');
  console.log('  node querybuilder.js open ecommerce.db');
  console.log('  node querybuilder.js migrate up ecommerce.db');
  console.log('  node querybuilder.js migrate status ecommerce.db');
  console.log();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    return;
  }

  const command = args[0];

  switch (command) {
    case 'init': {
      if (args.length < 2) {
        console.log(chalk.red('请指定数据库文件路径'));
        console.log(chalk.gray('用法: node querybuilder.js init <dbfile> [--migrate] [--seed] [--force]'));
        process.exit(1);
      }
      const dbFile = args[1];
      const options = {
        migrate: args.includes('--migrate'),
        seed: args.includes('--seed'),
        force: args.includes('--force')
      };
      await cmdInit(dbFile, options);
      break;
    }
    case 'open': {
      if (args.length < 2) {
        console.log(chalk.red('请指定数据库文件路径'));
        console.log(chalk.gray('用法: node querybuilder.js open <dbfile>'));
        process.exit(1);
      }
      const dbFile = args[1];
      await cmdOpen(dbFile);
      break;
    }
    case 'migrate': {
      const subCmd = args[1];
      let migrationName = null;
      let dbFile = null;

      if (subCmd === 'create') {
        migrationName = args[2];
        dbFile = args[3] || ':memory:';
      } else {
        dbFile = args[2];
      }

      if (!subCmd) {
        console.log(chalk.red('请指定迁移子命令'));
        console.log(chalk.gray('用法: node querybuilder.js migrate <create|up|down|status> [dbfile]'));
        process.exit(1);
      }

      if (subCmd !== 'create' && !dbFile) {
        console.log(chalk.red('请指定数据库文件路径'));
        process.exit(1);
      }

      await cmdMigrate(dbFile, subCmd, migrationName);
      break;
    }
    default:
      console.log(chalk.red(`未知命令: ${command}`));
      console.log(chalk.gray('运行 node querybuilder.js help 查看帮助'));
      process.exit(1);
  }
}

main().catch(e => {
  console.error(chalk.red('错误:'), e.message);
  console.error(e.stack);
  process.exit(1);
});
