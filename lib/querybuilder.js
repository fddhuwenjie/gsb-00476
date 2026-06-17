const chalk = require('chalk');
const Table = require('cli-table3');
const fs = require('fs');

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

class QueryBuilder {
  constructor(tableName, database) {
    this.table = tableName;
    this.db = database;
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
    const qb = new QueryBuilder(this.table, this.db);
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
    const fks1 = this.db.foreignKeys[table] || [];
    const match1 = fks1.find(fk => fk.table === joinTable);
    if (match1) {
      return `${table}.${match1.from} = ${joinTable}.${match1.to}`;
    }

    const fks2 = this.db.foreignKeys[joinTable] || [];
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
      const rows = await this.db.runQuery(sql, params);
      const duration = Date.now() - start;
      this.db.logQuery(sql, params, duration);
      console.log(chalk.green(`\n✓ 查询成功 (${duration}ms)`));
      printTable(rows);
      return rows;
    } else {
      const result = await this.db.runExec(sql, params);
      const duration = Date.now() - start;
      this.db.logQuery(sql, params, duration);
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

  save(name, storage) {
    const { sql, params } = this.toSQL();
    storage.savedScripts[name] = {
      sql,
      params,
      operation: this._operation,
      createdAt: new Date().toISOString()
    };
    storage.save();
    console.log(chalk.green(`✓ 脚本已保存为 '${name}'`));
    return this;
  }
}

function createDbProxy(database) {
  return new Proxy({}, {
    get: (target, prop) => {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'then') return undefined;

      if (prop === 'toSQL') return () => '';
      if (prop === 'exec') return async () => [];

      return new QueryBuilder(prop, database);
    }
  });
}

module.exports = { QueryBuilder, createDbProxy, printTable };
