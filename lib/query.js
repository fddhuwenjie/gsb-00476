const fs = require('fs');
const chalk = require('chalk');
const Table = require('cli-table3');
const dbModule = require('./db');
const persistence = require('./persistence');

let queryLog = [];

function getQueryLog() {
  return queryLog;
}

function clearQueryLog() {
  queryLog = [];
}

function printTable(rows) {
  if (!rows || rows.length === 0) {
    console.log(chalk.yellow('(空结果集)'));
    return;
  }

  const headers = Object.keys(rows[0]);
  const table = new Table({
    head: headers.map(h => chalk.cyan(h)),
    style: { head: [], border: [] }
  });

  rows.forEach(row => {
    table.push(headers.map(h => row[h] !== null ? row[h] : chalk.gray('NULL')));
  });

  console.log(table.toString());
  console.log(chalk.gray(`共 ${rows.length} 行`));
}

function printTableInfo(tableName) {
  const tableMetadata = dbModule.getTableMetadata();
  const foreignKeys = dbModule.getForeignKeys();
  const columns = tableMetadata[tableName];
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
    const fk = (foreignKeys[tableName] || []).find(f => f.from === col.name);
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

  const outFks = foreignKeys[tableName] || [];
  if (outFks.length > 0) {
    console.log(chalk.yellow(`\n外键关系:`));
    outFks.forEach(fk => {
      console.log(`  ${tableName}.${fk.from} → ${fk.table}.${fk.to}`);
    });
  }

  const inFks = [];
  Object.keys(foreignKeys).forEach(t => {
    foreignKeys[t].forEach(fk => {
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

class QueryBuilder {
  constructor(tableName) {
    this.table = tableName;
    this._select = ['*'];
    this._where = [];
    this._whereParams = [];
    this._joins = [];
    this._orderBy = [];
    this._groupBy = [];
    this._having = [];
    this._havingParams = [];
    this._limit = null;
    this._offset = null;
    this._aggregates = [];
    this._operation = 'select';
    this._insertData = null;
    this._updateData = null;
    this._subQuery = null;
    this._upsertKey = null;
    this._upsertUpdate = null;
    this._bulkInsertData = null;
  }

  _clone() {
    const qb = new QueryBuilder(this.table);
    Object.assign(qb, JSON.parse(JSON.stringify({
      _select: this._select,
      _where: this._where,
      _whereParams: this._whereParams,
      _joins: this._joins,
      _orderBy: this._orderBy,
      _groupBy: this._groupBy,
      _having: this._having,
      _havingParams: this._havingParams,
      _limit: this._limit,
      _offset: this._offset,
      _aggregates: this._aggregates,
      _operation: this._operation,
      _insertData: this._insertData,
      _updateData: this._updateData,
      _upsertKey: this._upsertKey,
      _upsertUpdate: this._upsertUpdate,
      _bulkInsertData: this._bulkInsertData
    })));
    qb._subQuery = this._subQuery;
    return qb;
  }

  select(...columns) {
    const qb = this._clone();
    qb._select = columns.flat();
    return qb;
  }

  where(condition, ...params) {
    const qb = this._clone();
    if (condition instanceof QueryBuilder) {
      const { sql, params: subParams } = condition._buildSelect();
      qb._where.push(`(${sql})`);
      qb._whereParams.push(...subParams);
    } else {
      qb._where.push(condition);
      qb._whereParams.push(...params);
    }
    return qb;
  }

  orWhere(condition, ...params) {
    const qb = this._clone();
    if (qb._where.length > 0) {
      qb._where[qb._where.length - 1] = `(${qb._where[qb._where.length - 1]}) OR (${condition})`;
    } else {
      qb._where.push(condition);
    }
    qb._whereParams.push(...params);
    return qb;
  }

  whereIn(column, values) {
    const qb = this._clone();
    if (values instanceof QueryBuilder) {
      const { sql, params: subParams } = values._buildSelect();
      qb._where.push(`${column} IN (${sql})`);
      qb._whereParams.push(...subParams);
    } else {
      const placeholders = values.map(() => '?').join(', ');
      qb._where.push(`${column} IN (${placeholders})`);
      qb._whereParams.push(...values);
    }
    return qb;
  }

  whereNull(column) {
    const qb = this._clone();
    qb._where.push(`${column} IS NULL`);
    return qb;
  }

  whereNotNull(column) {
    const qb = this._clone();
    qb._where.push(`${column} IS NOT NULL`);
    return qb;
  }

  whereBetween(column, min, max) {
    const qb = this._clone();
    qb._where.push(`${column} BETWEEN ? AND ?`);
    qb._whereParams.push(min, max);
    return qb;
  }

  _findAutoJoinCondition(table, joinTable) {
    const foreignKeys = dbModule.getForeignKeys();
    const fks1 = foreignKeys[table] || [];
    const match1 = fks1.find(fk => fk.table === joinTable);
    if (match1) {
      return `${table}.${match1.from} = ${joinTable}.${match1.to}`;
    }

    const fks2 = foreignKeys[joinTable] || [];
    const match2 = fks2.find(fk => fk.table === table);
    if (match2) {
      return `${joinTable}.${match2.from} = ${table}.${match2.to}`;
    }

    return null;
  }

  join(table, condition) {
    return this._join('INNER', table, condition);
  }

  innerJoin(table, condition) {
    return this._join('INNER', table, condition);
  }

  leftJoin(table, condition) {
    return this._join('LEFT', table, condition);
  }

  rightJoin(table, condition) {
    return this._join('RIGHT', table, condition);
  }

  _join(type, table, condition) {
    const qb = this._clone();
    let cond = condition;
    if (!condition) {
      cond = this._findAutoJoinCondition(this.table, table);
      if (!cond) {
        throw new Error(`无法自动推断 ${this.table} 和 ${table} 的关联条件，请手动指定`);
      }
      console.log(chalk.gray(`  自动检测关联: ${cond}`));
    }
    qb._joins.push({ type, table, condition: cond });
    return qb;
  }

  orderBy(column, direction = 'ASC') {
    const qb = this._clone();
    qb._orderBy.push({ column, direction: direction.toUpperCase() });
    return qb;
  }

  groupBy(...columns) {
    const qb = this._clone();
    qb._groupBy.push(...columns.flat());
    return qb;
  }

  having(condition, ...params) {
    const qb = this._clone();
    qb._having.push(condition);
    qb._havingParams.push(...params);
    return qb;
  }

  limit(n) {
    const qb = this._clone();
    qb._limit = n;
    return qb;
  }

  offset(n) {
    const qb = this._clone();
    qb._offset = n;
    return qb;
  }

  count(column = '*') {
    const qb = this._clone();
    qb._aggregates.push({ func: 'COUNT', column, alias: `count_${column.replace(/\*/g, 'all')}` });
    return qb;
  }

  sum(column) {
    const qb = this._clone();
    qb._aggregates.push({ func: 'SUM', column, alias: `sum_${column}` });
    return qb;
  }

  avg(column) {
    const qb = this._clone();
    qb._aggregates.push({ func: 'AVG', column, alias: `avg_${column}` });
    return qb;
  }

  min(column) {
    const qb = this._clone();
    qb._aggregates.push({ func: 'MIN', column, alias: `min_${column}` });
    return qb;
  }

  max(column) {
    const qb = this._clone();
    qb._aggregates.push({ func: 'MAX', column, alias: `max_${column}` });
    return qb;
  }

  insert(data) {
    const qb = this._clone();
    qb._operation = 'insert';
    qb._insertData = data;
    return qb;
  }

  update(data) {
    const qb = this._clone();
    qb._operation = 'update';
    qb._updateData = data;
    return qb;
  }

  delete() {
    const qb = this._clone();
    qb._operation = 'delete';
    return qb;
  }

  upsert(keyObj, updateObj) {
    const qb = this._clone();
    qb._operation = 'upsert';
    qb._upsertKey = keyObj;
    qb._upsertUpdate = updateObj;
    return qb;
  }

  bulkInsert(dataArray) {
    const qb = this._clone();
    qb._operation = 'bulkInsert';
    qb._bulkInsertData = dataArray;
    return qb;
  }

  _buildSelect() {
    let columns = this._select;

    if (this._aggregates.length > 0) {
      const aggCols = this._aggregates.map(a => `${a.func}(${a.column}) AS ${a.alias}`);
      columns = [...this._groupBy, ...aggCols];
    }

    let sql = `SELECT ${columns.join(', ')} FROM "${this.table}"`;
    let params = [];

    this._joins.forEach(join => {
      sql += ` ${join.type} JOIN "${join.table}" ON ${join.condition}`;
    });

    if (this._where.length > 0) {
      sql += ` WHERE ${this._where.join(' AND ')}`;
      params.push(...this._whereParams);
    }

    if (this._groupBy.length > 0) {
      sql += ` GROUP BY ${this._groupBy.join(', ')}`;
    }

    if (this._having.length > 0) {
      sql += ` HAVING ${this._having.join(' AND ')}`;
      params.push(...this._havingParams);
    }

    if (this._orderBy.length > 0) {
      const orderClauses = this._orderBy.map(o => `${o.column} ${o.direction}`);
      sql += ` ORDER BY ${orderClauses.join(', ')}`;
    }

    if (this._limit !== null) {
      sql += ` LIMIT ${this._limit}`;
    }

    if (this._offset !== null) {
      sql += ` OFFSET ${this._offset}`;
    }

    return { sql, params };
  }

  _buildInsert() {
    const data = this._insertData;
    const columns = Object.keys(data);
    const placeholders = columns.map(() => '?').join(', ');
    const sql = `INSERT INTO "${this.table}" (${columns.join(', ')}) VALUES (${placeholders})`;
    const params = columns.map(c => data[c]);
    return { sql, params };
  }

  _buildUpdate() {
    const data = this._updateData;
    const setClauses = Object.keys(data).map(k => `${k} = ?`);
    let sql = `UPDATE "${this.table}" SET ${setClauses.join(', ')}`;
    let params = Object.values(data);

    if (this._where.length > 0) {
      sql += ` WHERE ${this._where.join(' AND ')}`;
      params.push(...this._whereParams);
    }

    return { sql, params };
  }

  _buildDelete() {
    let sql = `DELETE FROM "${this.table}"`;
    let params = [];

    if (this._where.length > 0) {
      sql += ` WHERE ${this._where.join(' AND ')}`;
      params.push(...this._whereParams);
    }

    return { sql, params };
  }

  _buildUpsert() {
    const keyObj = this._upsertKey;
    const updateObj = this._upsertUpdate;
    const allData = Object.assign({}, keyObj, updateObj);
    const allColumns = Object.keys(allData);
    const keyColumns = Object.keys(keyObj);
    const updateColumns = Object.keys(updateObj);
    const placeholders = allColumns.map(() => '?').join(', ');
    const conflictCols = keyColumns.join(', ');
    const setClauses = updateColumns.map(c => `${c} = ?`).join(', ');
    const sql = `INSERT INTO "${this.table}" (${allColumns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(${conflictCols}) DO UPDATE SET ${setClauses}`;
    const params = [...allColumns.map(c => allData[c]), ...updateColumns.map(c => updateObj[c])];
    return { sql, params };
  }

  _buildBulkInsert() {
    const dataArray = this._bulkInsertData;
    if (!dataArray || dataArray.length === 0) {
      throw new Error('bulkInsert 需要非空数组');
    }
    const columns = Object.keys(dataArray[0]);
    const rowPlaceholders = `(${columns.map(() => '?').join(', ')})`;
    const allPlaceholders = dataArray.map(() => rowPlaceholders).join(', ');
    const sql = `INSERT INTO "${this.table}" (${columns.join(', ')}) VALUES ${allPlaceholders}`;
    const params = [];
    dataArray.forEach(row => {
      columns.forEach(c => params.push(row[c] !== undefined ? row[c] : null));
    });
    return { sql, params };
  }

  toSQL() {
    switch (this._operation) {
      case 'insert': return this._buildInsert();
      case 'update': return this._buildUpdate();
      case 'delete': return this._buildDelete();
      case 'upsert': return this._buildUpsert();
      case 'bulkInsert': return this._buildBulkInsert();
      default: return this._buildSelect();
    }
  }

  then(onFulfilled, onRejected) {
    return this.exec().then(onFulfilled, onRejected);
  }

  async exec() {
    const { sql, params } = this.toSQL();
    console.log(chalk.blue(`\n生成的 SQL: ${sql}`));
    if (params.length > 0) {
      console.log(chalk.gray(`参数: [${params.join(', ')}]`));
    }

    const start = Date.now();

    if (this._operation === 'select') {
      const rows = await dbModule.runQuery(sql, params);
      const duration = Date.now() - start;
      queryLog.push({ sql, params, duration, timestamp: new Date().toISOString() });
      console.log(chalk.green(`\n✓ 查询成功 (${duration}ms)`));
      printTable(rows);
      return rows;
    } else {
      const result = await dbModule.runExec(sql, params);
      const duration = Date.now() - start;
      queryLog.push({ sql, params, duration, timestamp: new Date().toISOString() });
      console.log(chalk.green(`\n✓ 操作成功 (${duration}ms)`));
      if (this._operation === 'insert') {
        console.log(`  影响行数: ${result.changes}, 新记录ID: ${result.lastID}`);
      } else if (this._operation === 'upsert') {
        console.log(`  影响行数: ${result.changes}`);
      } else if (this._operation === 'bulkInsert') {
        console.log(`  插入行数: ${result.changes}`);
      } else {
        console.log(`  影响行数: ${result.changes}`);
      }
      return result;
    }
  }

  async export(format, filename) {
    const rows = await this.exec();
    let content = '';

    switch (format.toLowerCase()) {
      case 'csv':
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
        break;
      case 'json':
        content = JSON.stringify(rows, null, 2);
        break;
      case 'md':
      case 'markdown':
        if (rows.length > 0) {
          const headers = Object.keys(rows[0]);
          content = '| ' + headers.join(' | ') + ' |\n';
          content += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
          rows.forEach(row => {
            content += '| ' + headers.map(h => row[h] !== null ? row[h] : '').join(' | ') + ' |\n';
          });
        }
        break;
      default:
        throw new Error(`不支持的导出格式: ${format}`);
    }

    const exportFile = filename || `export_${Date.now()}.${format.toLowerCase()}`;
    fs.writeFileSync(exportFile, content, 'utf8');
    console.log(chalk.green(`\n✓ 已导出到 ${exportFile}`));
    return rows;
  }

  save(name, dataDir) {
    const { sql, params } = this.toSQL();
    const scripts = persistence.loadScripts(dataDir);
    scripts[name] = {
      sql,
      params,
      operation: this._operation,
      createdAt: new Date().toISOString()
    };
    persistence.saveScripts(dataDir, scripts);
    console.log(chalk.green(`✓ 脚本已保存为 '${name}'`));
    return this;
  }
}

function createDbProxy() {
  return new Proxy({}, {
    get: (target, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'then') return undefined;

      if (prop === 'toSQL') return () => '';
      if (prop === 'exec') return async () => [];

      return new QueryBuilder(prop);
    }
  });
}

function showSlowQueries(threshold) {
  const th = parseInt(threshold) || 100;
  const slow = queryLog.filter(q => q.duration >= th);

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

async function explainQuery(queryStr) {
  const dbProxy = createDbProxy();
  try {
    const qb = eval(`(function(db) { return ${queryStr}; })(dbProxy)`);
    const { sql, params } = qb.toSQL();
    console.log(chalk.blue(`查询 SQL: ${sql}`));
    if (params.length > 0) {
      console.log(chalk.gray(`参数: [${params.join(', ')}]`));
    }

    const explainRows = await dbModule.runQuery(`EXPLAIN QUERY PLAN ${sql}`, params);

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

async function suggestIndexes() {
  const tableMetadata = dbModule.getTableMetadata();
  const foreignKeys = dbModule.getForeignKeys();
  const suggestions = [];

  for (const tableName of Object.keys(foreignKeys)) {
    const fks = foreignKeys[tableName];
    if (!fks || fks.length === 0) continue;

    let indexes;
    try {
      indexes = await dbModule.runQuery(`PRAGMA index_list("${tableName}")`);
    } catch (e) {
      continue;
    }

    const indexedColumns = new Set();
    for (const idx of indexes) {
      try {
        const idxInfo = await dbModule.runQuery(`PRAGMA index_info("${idx.name}")`);
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

  for (const tableName of Object.keys(tableMetadata)) {
    const columns = tableMetadata[tableName];
    try {
      const indexes = await dbModule.runQuery(`PRAGMA index_list("${tableName}")`);
      const indexedColumns = new Set();
      for (const idx of indexes) {
        const idxInfo = await dbModule.runQuery(`PRAGMA index_info("${idx.name}")`);
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

async function generateSchema(outputFile) {
  const tableMetadata = dbModule.getTableMetadata();
  const foreignKeys = dbModule.getForeignKeys();
  let dot = 'digraph ER {\n';
  dot += '  node [shape=record];\n';
  dot += '  rankdir=LR;\n\n';

  for (const tableName of Object.keys(tableMetadata)) {
    const columns = tableMetadata[tableName];
    const fks = foreignKeys[tableName] || [];
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

  for (const tableName of Object.keys(foreignKeys)) {
    const fks = foreignKeys[tableName];
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

async function generateDoc(outputFile) {
  const tableMetadata = dbModule.getTableMetadata();
  const foreignKeys = dbModule.getForeignKeys();
  let md = '# Database Documentation\n\n';
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `Tables: ${Object.keys(tableMetadata).length}\n\n`;

  for (const tableName of Object.keys(tableMetadata)) {
    const columns = tableMetadata[tableName];
    const fks = foreignKeys[tableName] || [];

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
      const indexes = await dbModule.runQuery(`PRAGMA index_list("${tableName}")`);
      if (indexes.length > 0) {
        md += '### Indexes\n\n';
        md += '| Index Name | Unique | Columns |\n';
        md += '|------------|--------|--------|\n';
        for (const idx of indexes) {
          const idxInfo = await dbModule.runQuery(`PRAGMA index_info("${idx.name}")`);
          const cols = idxInfo.map(i => i.name).join(', ');
          md += `| ${idx.name} | ${idx.unique ? 'Yes' : 'No'} | ${cols} |\n`;
        }
        md += '\n';
      }
    } catch (e) {}

    try {
      const sampleRows = await dbModule.runQuery(`SELECT * FROM "${tableName}" LIMIT 3`);
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

module.exports = {
  QueryBuilder,
  createDbProxy,
  printTable,
  printTableInfo,
  showSlowQueries,
  explainQuery,
  suggestIndexes,
  generateSchema,
  generateDoc,
  getQueryLog,
  clearQueryLog
};
