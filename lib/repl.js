const readline = require('readline');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const Table = require('cli-table3');
const { createDbProxy, printTable } = require('./querybuilder');
const MigrationManager = require('./migrate');

class REPL {
  constructor(database, storage, migrationsDir) {
    this.db = database;
    this.storage = storage;
    this.migrationsDir = migrationsDir;
    this.dbProxy = createDbProxy(database);
    this.migrationManager = new MigrationManager(database, migrationsDir);
    this.rl = null;
  }

  start() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.green('db> ')
    });

    console.log(chalk.bold('\n╔════════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold('║          SQLite 查询构建器 CLI - 交互式 REPL             ║'));
    console.log(chalk.bold('╚════════════════════════════════════════════════════════════╝'));
    console.log(chalk.gray('输入 help 查看帮助, exit 退出'));
    console.log();

    this.rl.prompt();

    this.rl.on('line', async (line) => {
      try {
        await this.executeCommand(line);
      } catch (e) {
        console.log(chalk.red(`错误: ${e.message}`));
      }
      this.rl.prompt();
    });

    this.rl.on('close', () => {
      console.log(chalk.yellow('\n再见!'));
      this.storage.save();
      process.exit(0);
    });
  }

  printTableInfo(tableName) {
    const columns = this.db.tableMetadata[tableName];
    if (!columns) {
      console.log(chalk.red(`表 '${tableName}' 不存在`));
      return;
    }

    const table = new Table({
      head: [chalk.cyan('列名'), chalk.cyan('类型'), chalk.cyan('约束'), chalk.cyan('主键')],
      style: { head: [], border: [] }
    });

    columns.forEach(col => {
      const constraints = [];
      if (col.notnull) constraints.push('NOT NULL');
      if (col.dflt_value !== null) constraints.push(`DEFAULT ${col.dflt_value}`);
      const fk = (this.db.foreignKeys[tableName] || []).find(f => f.from === col.name);
      if (fk) constraints.push(`FK → ${fk.table}.${fk.to}`);

      table.push([
        col.name,
        col.type || chalk.gray('(无)'),
        constraints.join(', ') || chalk.gray('(无)'),
        col.pk ? chalk.green('✓') : ''
      ]);
    });

    console.log(chalk.bold(`\n表: ${tableName}`));
    console.log(table.toString());

    const outFks = this.db.foreignKeys[tableName] || [];
    if (outFks.length > 0) {
      console.log(chalk.yellow(`\n外键关系:`));
      outFks.forEach(fk => {
        console.log(`  ${tableName}.${fk.from} → ${fk.table}.${fk.to}`);
      });
    }

    const inFks = [];
    Object.keys(this.db.foreignKeys).forEach(t => {
      this.db.foreignKeys[t].forEach(fk => {
        if (fk.table === tableName) {
          inFks.push({ from: `${t}.${fk.from}`, to: fk.to });
        }
      });
    });
    if (inFks.length > 0) {
      console.log(chalk.yellow(`\n被引用关系:`));
      inFks.forEach(fk => {
        console.log(`  ${fk.from} → ${tableName}.${fk.to}`);
      });
    }
  }

  async explainQuery(queryStr) {
    try {
      const qb = eval(`(function(db) { return ${queryStr}; })(this.dbProxy)`);
      const { sql, params } = qb.toSQL();
      console.log(chalk.blue(`查询 SQL: ${sql}`));
      if (params.length > 0) {
        console.log(chalk.gray(`参数: [${params.join(', ')}]`));
      }

      const explainRows = await this.db.runQuery(`EXPLAIN QUERY PLAN ${sql}`, params);

      console.log(chalk.bold('\n执行计划:'));
      explainRows.forEach(row => {
        const detail = row.detail || '';
        let icon = chalk.cyan('→');
        if (detail.includes('SCAN TABLE')) icon = chalk.yellow('⚠ 全表扫描');
        if (detail.includes('USING INDEX')) icon = chalk.green('✓ 使用索引');
        if (detail.includes('USING COVERING INDEX')) icon = chalk.green('✓ 覆盖索引');
        console.log(`  ${icon} ${detail}`);
      });
    } catch (e) {
      console.log(chalk.red(`错误: ${e.message}`));
    }
  }

  async suggestIndexes() {
    const suggestions = [];

    for (const tableName of Object.keys(this.db.foreignKeys)) {
      const fks = this.db.foreignKeys[tableName];
      if (!fks || fks.length === 0) continue;

      let indexes;
      try {
        indexes = await this.db.runQuery(`PRAGMA index_list("${tableName}")`);
      } catch (e) {
        continue;
      }

      const indexedColumns = new Set();
      for (const idx of indexes) {
        try {
          const idxInfo = await this.db.runQuery(`PRAGMA index_info("${idx.name}")`);
          idxInfo.forEach(i => indexedColumns.add(i.name));
        } catch (e) {}
      }

      fks.forEach(fk => {
        if (!indexedColumns.has(fk.from)) {
          suggestions.push({
            table: tableName,
            column: fk.from,
            reason: `外键列缺少索引 (${tableName}.${fk.from} → ${fk.table}.${fk.to})`,
            sql: `CREATE INDEX idx_${tableName}_${fk.from} ON "${tableName}" (${fk.from});`
          });
        }
      });
    }

    for (const tableName of Object.keys(this.db.tableMetadata)) {
      const columns = this.db.tableMetadata[tableName];
      try {
        const indexes = await this.db.runQuery(`PRAGMA index_list("${tableName}")`);
        const indexedColumns = new Set();
        for (const idx of indexes) {
          const idxInfo = await this.db.runQuery(`PRAGMA index_info("${idx.name}")`);
          idxInfo.forEach(i => indexedColumns.add(i.name));
        }
        columns.forEach(col => {
          if (!col.pk && col.notnull && !indexedColumns.has(col.name)) {
            const alreadySuggested = suggestions.some(s => s.table === tableName && s.column === col.name);
            if (!alreadySuggested) {
              suggestions.push({
                table: tableName,
                column: col.name,
                reason: `高频查询列建议加索引 (${tableName}.${col.name})`,
                sql: `CREATE INDEX idx_${tableName}_${col.name} ON "${tableName}" (${col.name});`
              });
            }
          }
        });
      } catch (e) {}
    }

    if (suggestions.length === 0) {
      console.log(chalk.green('✓ 未发现明显的索引缺失'));
      return;
    }

    console.log(chalk.bold('\n索引建议:'));
    suggestions.forEach((s, i) => {
      console.log(chalk.yellow(`\n${i + 1}. ${s.reason}`));
      console.log(chalk.cyan(`   ${s.sql}`));
    });
  }

  showSlowQueries(threshold) {
    const th = parseInt(threshold) || 100;
    const slow = this.db.queryLog.filter(q => q.duration >= th);

    if (slow.length === 0) {
      console.log(chalk.green(`✓ 没有超过 ${th}ms 的慢查询`));
      return;
    }

    console.log(chalk.bold(`\n慢查询 (>= ${th}ms):`));
    const table = new Table({
      head: [chalk.cyan('SQL'), chalk.cyan('耗时'), chalk.cyan('时间')],
      style: { head: [], border: [] }
    });

    slow.forEach(q => {
      const shortSql = q.sql.length > 60 ? q.sql.slice(0, 60) + '...' : q.sql;
      table.push([shortSql, `${q.duration}ms`, q.timestamp]);
    });

    console.log(table.toString());
  }

  async generateSchema(outputFile) {
    let dot = 'digraph ER {\n';
    dot += '  node [shape=record];\n';
    dot += '  rankdir=LR;\n\n';

    for (const tableName of Object.keys(this.db.tableMetadata)) {
      const columns = this.db.tableMetadata[tableName];
      const fks = this.db.foreignKeys[tableName] || [];
      const fkMap = {};
      fks.forEach(fk => { fkMap[fk.from] = fk; });

      let label = `{${tableName}|`;
      columns.forEach(col => {
        let colDef = col.name + ' ' + (col.type || '');
        if (col.pk) colDef += ' PK';
        if (fkMap[col.name]) colDef += ' FK';
        if (col.notnull) colDef += ' NOT NULL';
        label += colDef + '\\l';
      });
      label += '}';

      dot += `  "${tableName}" [label="${label}"];\n`;
    }

    dot += '\n';

    for (const tableName of Object.keys(this.db.foreignKeys)) {
      const fks = this.db.foreignKeys[tableName];
      fks.forEach(fk => {
        dot += `  "${tableName}" -> "${fk.table}" [label="${fk.from} → ${fk.to}"];\n`;
      });
    }

    dot += '}\n';

    if (outputFile) {
      fs.writeFileSync(outputFile, dot, 'utf8');
      console.log(chalk.green(`✓ ER图已保存到 ${outputFile}`));
    } else {
      console.log(dot);
    }
  }

  async generateDoc(outputFile) {
    let md = '# Database Documentation\n\n';
    md += `Generated: ${new Date().toISOString()}\n\n`;
    md += `Tables: ${Object.keys(this.db.tableMetadata).length}\n\n`;

    for (const tableName of Object.keys(this.db.tableMetadata)) {
      const columns = this.db.tableMetadata[tableName];
      const fks = this.db.foreignKeys[tableName] || [];

      md += `## ${tableName}\n\n`;

      md += '| Column | Type | Nullable | Default | Primary Key |\n';
      md += '|--------|------|----------|---------|-------------|\n';
      columns.forEach(col => {
        const fk = fks.find(f => f.from === col.name);
        let type = col.type || '-';
        if (fk) type += ` (FK → ${fk.table}.${fk.to})`;
        md += `| ${col.name} | ${type} | ${col.notnull ? 'No' : 'Yes'} | ${col.dflt_value !== null ? col.dflt_value : '-'} | ${col.pk ? 'Yes' : 'No'} |\n`;
      });
      md += '\n';

      if (fks.length > 0) {
        md += '### Foreign Keys\n\n';
        fks.forEach(fk => {
          md += `- ${tableName}.${fk.from} → ${fk.table}.${fk.to}\n`;
        });
        md += '\n';
      }

      try {
        const indexes = await this.db.runQuery(`PRAGMA index_list("${tableName}")`);
        if (indexes.length > 0) {
          md += '### Indexes\n\n';
          md += '| Index Name | Unique | Columns |\n';
          md += '|------------|--------|--------|\n';
          for (const idx of indexes) {
            const idxInfo = await this.db.runQuery(`PRAGMA index_info("${idx.name}")`);
            const cols = idxInfo.map(i => i.name).join(', ');
            md += `| ${idx.name} | ${idx.unique ? 'Yes' : 'No'} | ${cols} |\n`;
          }
          md += '\n';
        }
      } catch (e) {}

      try {
        const sampleRows = await this.db.runQuery(`SELECT * FROM "${tableName}" LIMIT 3`);
        if (sampleRows.length > 0) {
          md += '### Sample Data\n\n';
          const headers = Object.keys(sampleRows[0]);
          md += '| ' + headers.join(' | ') + ' |\n';
          md += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
          sampleRows.forEach(row => {
            md += '| ' + headers.map(h => row[h] !== null ? row[h] : 'NULL').join(' | ') + ' |\n';
          });
          md += '\n';
        }
      } catch (e) {}
    }

    if (outputFile) {
      fs.writeFileSync(outputFile, md, 'utf8');
      console.log(chalk.green(`✓ 文档已保存到 ${outputFile}`));
    } else {
      console.log(md);
    }
  }

  resolveTemplate(name, visited) {
    if (!visited) visited = new Set();
    if (visited.has(name)) throw new Error(`循环引用模板: ${name}`);
    visited.add(name);

    const tmpl = this.storage.templates[name];
    if (!tmpl) throw new Error(`模板 '${name}' 不存在`);

    let query = tmpl.query;
    query = query.replace(/\{\{(\w+)\}\}/g, (match, refName) => {
      return this.resolveTemplate(refName, new Set(visited));
    });

    return query;
  }

  extractParams(query) {
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

  templateCreate(name, query) {
    this.storage.saveTemplate(name, query);
    console.log(chalk.green(`✓ 模板 '${name}' 已创建`));
    const params = this.extractParams(query);
    if (params.length > 0) {
      console.log(chalk.gray(`  参数: ${params.map(p => ':' + p).join(', ')}`));
    }
  }

  async templateRun(name, paramStr) {
    let query = this.resolveTemplate(name);

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
    await this.executeCommand(query);
  }

  templateList() {
    const names = Object.keys(this.storage.templates);
    if (names.length === 0) {
      console.log(chalk.yellow('暂无保存的模板'));
      return;
    }

    const table = new Table({
      head: [chalk.cyan('名称'), chalk.cyan('查询'), chalk.cyan('参数')],
      style: { head: [], border: [] }
    });

    names.forEach(name => {
      const params = this.extractParams(this.storage.templates[name].query);
      const queryStr = this.storage.templates[name].query;
      table.push([
        name,
        queryStr.length > 50 ? queryStr.slice(0, 50) + '...' : queryStr,
        params.length > 0 ? params.map(p => ':' + p).join(', ') : '(无)'
      ]);
    });

    console.log(table.toString());
  }

  async evaluateQuery(queryStr) {
    try {
      const trimmed = queryStr.trim().replace(/;+$/, '');
      const result = await eval(`(async function(db, console) { return ${trimmed}; })(this.dbProxy, console)`);
      return result;
    } catch (e) {
      console.log(chalk.red(`错误: ${e.message}`));
      return null;
    }
  }

  async executeCommand(line) {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed === 'exit' || trimmed === 'quit' || trimmed === '.exit') {
      console.log(chalk.yellow('再见!'));
      this.storage.save();
      process.exit(0);
    }

    if (trimmed === 'help' || trimmed === '.help') {
      this.printHelp();
      return;
    }

    if (trimmed === 'tables') {
      const tables = Object.keys(this.db.tableMetadata);
      console.log(chalk.bold('\n数据库中的表:'));
      tables.forEach(t => {
        const count = this.db.tableMetadata[t].length;
        console.log(`  ${chalk.cyan(t)} (${count} 列)`);
      });
      console.log();
      return;
    }

    if (trimmed.startsWith('describe ')) {
      const tableName = trimmed.slice(9).trim();
      this.printTableInfo(tableName);
      return;
    }

    if (trimmed.startsWith('sample ')) {
      const tableName = trimmed.slice(7).trim();
      if (!this.db.tableMetadata[tableName]) {
        console.log(chalk.red(`表 '${tableName}' 不存在`));
        return;
      }
      const sql = `SELECT * FROM "${tableName}" LIMIT 10`;
      console.log(chalk.blue(`\n生成的 SQL: ${sql}`));
      const rows = await this.db.runQuery(sql);
      console.log(chalk.green('\n✓ 查询成功'));
      printTable(rows);
      return;
    }

    if (trimmed.startsWith('count ')) {
      const tableName = trimmed.slice(6).trim();
      if (!this.db.tableMetadata[tableName]) {
        console.log(chalk.red(`表 '${tableName}' 不存在`));
        return;
      }
      const sql = `SELECT COUNT(*) as count FROM "${tableName}"`;
      console.log(chalk.blue(`\n生成的 SQL: ${sql}`));
      const rows = await this.db.runQuery(sql);
      console.log(chalk.green(`\n✓ 表 '${tableName}' 共有 ${rows[0].count} 行数据`));
      return;
    }

    if (trimmed === 'history') {
      console.log(chalk.bold('\n查询历史:'));
      this.storage.history.forEach((h, i) => {
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
      this.storage.saveScript(name, query);
      console.log(chalk.green(`✓ 脚本 '${name}' 已保存`));
      return;
    }

    if (trimmed.startsWith('run ')) {
      const name = trimmed.slice(4).trim();
      const script = this.storage.getScript(name);
      if (!script) {
        console.log(chalk.red(`脚本 '${name}' 不存在`));
        return;
      }
      console.log(chalk.cyan(`执行脚本 '${name}': ${script.query}`));
      await this.executeCommand(script.query);
      return;
    }

    if (trimmed === 'scripts' || trimmed === 'ls scripts') {
      console.log(chalk.bold('\n已保存的脚本:'));
      Object.keys(this.storage.savedScripts).forEach(name => {
        const s = this.storage.savedScripts[name];
        console.log(`  ${chalk.cyan(name)}: ${s.query}`);
      });
      if (Object.keys(this.storage.savedScripts).length === 0) {
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
            const rows = await this.db.runQuery(stmt.trim());
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

      const result = await this.evaluateQuery(query);
      if (result && result.rows) {
        if (format === 'csv') this.exportToCsv(result.rows, filename);
        else if (format === 'json') this.exportToJson(result.rows, filename);
        else if (format === 'md' || format === 'markdown') this.exportToMarkdown(result.rows, filename);
        else console.log(chalk.red(`不支持的格式: ${format}`));
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
        await this.migrationManager.create(name);
      } else if (sub === 'up') {
        await this.migrationManager.up();
      } else if (sub === 'down') {
        await this.migrationManager.down();
      } else if (sub === 'status') {
        await this.migrationManager.status();
      } else {
        console.log(chalk.red('用法: migrate create <名称> | migrate up | migrate down | migrate status'));
      }
      return;
    }

    if (trimmed.startsWith('explain ')) {
      const queryStr = trimmed.slice(8).trim();
      await this.explainQuery(queryStr);
      return;
    }

    if (trimmed === 'suggest') {
      await this.suggestIndexes();
      return;
    }

    if (trimmed.startsWith('slow')) {
      const parts = trimmed.slice(4).trim();
      this.showSlowQueries(parts || '100');
      return;
    }

    if (trimmed === 'begin') {
      if (this.db.inTransaction) {
        console.log(chalk.yellow('已在事务中'));
        return;
      }
      try {
        await this.db.runExec('BEGIN TRANSACTION');
        this.db.inTransaction = true;
        console.log(chalk.green('✓ 事务已开始'));
      } catch (e) {
        console.log(chalk.red(`错误: ${e.message}`));
      }
      return;
    }

    if (trimmed === 'commit') {
      if (!this.db.inTransaction) {
        console.log(chalk.yellow('没有活动的事务'));
        return;
      }
      try {
        await this.db.runExec('COMMIT');
        this.db.inTransaction = false;
        console.log(chalk.green('✓ 事务已提交'));
      } catch (e) {
        console.log(chalk.red(`错误: ${e.message}`));
      }
      return;
    }

    if (trimmed === 'rollback') {
      if (!this.db.inTransaction) {
        console.log(chalk.yellow('没有活动的事务'));
        return;
      }
      try {
        await this.db.runExec('ROLLBACK');
        this.db.inTransaction = false;
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
        await this.db.runExec('BEGIN TRANSACTION');
        this.db.inTransaction = true;
        for (let i = 0; i < queries.length; i++) {
          try {
            console.log(chalk.cyan(`\n[${i + 1}/${queries.length}] ${queries[i]}`));
            await this.evaluateQuery(queries[i]);
          } catch (e) {
            await this.db.runExec('ROLLBACK');
            this.db.inTransaction = false;
            console.log(chalk.red(`\n✗ 批量操作在第 ${i + 1} 条失败: ${e.message}`));
            console.log(chalk.yellow('所有操作已回滚'));
            return;
          }
        }
        await this.db.runExec('COMMIT');
        this.db.inTransaction = false;
        console.log(chalk.green(`\n✓ 批量操作成功 (${queries.length} 条)`));
      } catch (e) {
        console.log(chalk.red(`批量操作错误: ${e.message}`));
        try {
          if (this.db.inTransaction) {
            await this.db.runExec('ROLLBACK');
            this.db.inTransaction = false;
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
      await this.generateSchema(outputFile);
      return;
    }

    if (trimmed.startsWith('doc')) {
      const rest = trimmed.slice(3).trim();
      let outputFile = null;
      const oMatch = rest.match(/-o\s+(\S+)/);
      if (oMatch) {
        outputFile = oMatch[1];
      }
      await this.generateDoc(outputFile);
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
        this.templateCreate(name, query);
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
        await this.templateRun(name, paramStr);
      } else if (sub === 'list') {
        this.templateList();
      } else {
        console.log(chalk.red('用法: template create <名称> <查询> | template run <名称> [--param=value...] | template list'));
      }
      return;
    }

    if (trimmed.startsWith('db.') || trimmed.startsWith('db[')) {
      this.storage.addHistory(trimmed);
      await this.evaluateQuery(trimmed);
      return;
    }

    try {
      this.storage.addHistory(trimmed);
      console.log(chalk.blue(`\nSQL: ${trimmed}`));
      const rows = await this.db.runQuery(trimmed);
      printTable(rows);
    } catch (e) {
      console.log(chalk.red(`错误: ${e.message}`));
    }
  }

  exportToCsv(rows, filename) {
    let content = '';
    if (rows.length > 0) {
      const headers = Object.keys(rows[0]);
      content = headers.join(',') + '\n';
      rows.forEach(row => {
        content += headers.map(h => {
          const val = row[h];
          if (typeof val === 'string' && val.includes(',')) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          return val !== null ? val : '';
        }).join(',') + '\n';
      });
    }
    const exportFile = filename || `export_${Date.now()}.csv`;
    fs.writeFileSync(exportFile, content, 'utf8');
    console.log(chalk.green(`✓ 已导出到 ${exportFile}`));
  }

  exportToJson(rows, filename) {
    const exportFile = filename || `export_${Date.now()}.json`;
    fs.writeFileSync(exportFile, JSON.stringify(rows, null, 2), 'utf8');
    console.log(chalk.green(`✓ 已导出到 ${exportFile}`));
  }

  exportToMarkdown(rows, filename) {
    let content = '';
    if (rows.length > 0) {
      const headers = Object.keys(rows[0]);
      content = '| ' + headers.join(' | ') + ' |\n';
      content += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
      rows.forEach(row => {
        content += '| ' + headers.map(h => row[h] !== null ? row[h] : '').join(' | ') + ' |\n';
      });
    }
    const exportFile = filename || `export_${Date.now()}.md`;
    fs.writeFileSync(exportFile, content, 'utf8');
    console.log(chalk.green(`✓ 已导出到 ${exportFile}`));
  }

  printHelp() {
    console.log(chalk.bold('\n可用命令:'));
    console.log(chalk.cyan('\n数据库探索:'));
    console.log('  tables              - 列出所有表');
    console.log('  describe <table>    - 显示表结构');
    console.log('  sample <table>      - 显示前10行数据');
    console.log('  count <table>       - 显示行数');

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
    console.log('  export csv out.csv db.users.limit(5)  - 导出为CSV');
    console.log('  export json out.json db.users.limit(5) - 导出为JSON');
    console.log('  export md out.md db.users.limit(5)    - 导出为Markdown');
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
}

module.exports = REPL;
