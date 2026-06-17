# SQLite 查询构建器 CLI - 使用说明

基于 SQLite 的交互式查询构建工具，提供链式查询、迁移管理、数据持久化等功能。

## 目录

- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [命令详解](#命令详解)
  - [init - 初始化数据库](#init---初始化数据库)
  - [open - 打开数据库](#open---打开数据库)
  - [migrate - 迁移管理](#migrate---迁移管理)
- [交互式 REPL](#交互式-repl)
  - [数据库探索](#数据库探索)
  - [链式查询](#链式查询)
  - [数据操作](#数据操作)
  - [查询模板](#查询模板)
  - [脚本与历史](#脚本与历史)
  - [事务与批量操作](#事务与批量操作)
  - [查询优化分析](#查询优化分析)
  - [文档与ER图](#文档与er图)
- [数据持久化](#数据持久化)
- [常见问题](#常见问题)

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 初始化数据库

一步到位初始化数据库，执行迁移并填充种子数据：

```bash
npm run init
# 或手动执行
node querybuilder.js init data/ecommerce.db --migrate --seed
```

### 3. 打开数据库进入交互模式

```bash
npm run open
# 或手动执行
node querybuilder.js open data/ecommerce.db
```

### 4. 查看帮助

```bash
node querybuilder.js help
```

## 项目结构

```
.
├── querybuilder.js      # 主入口文件 (CLI + REPL)
├── seed.js              # 种子数据脚本
├── migrations/          # 数据库迁移目录
│   └── *.js             # 迁移文件
├── lib/                 # 核心模块
│   ├── db.js           # 数据库操作
│   ├── query.js        # 查询构建器
│   ├── migrations.js   # 迁移系统
│   ├── persistence.js  # 持久化管理
│   └── env.js          # 环境检查
├── data/                # 数据库文件目录 (默认)
│   ├── ecommerce.db     # SQLite 数据库文件
│   └── ecommerce.data/  # 配套数据目录 (历史/脚本/模板)
└── package.json
```

## 命令详解

### init - 初始化数据库

创建新数据库并可选地执行迁移和填充种子数据。

```bash
node querybuilder.js init <dbfile> [options]
```

**选项：**

| 选项 | 说明 |
|------|------|
| `--migrate` | 初始化后执行所有待处理的迁移 |
| `--seed` | 初始化后填充种子数据 |
| `--force` | 强制覆盖已存在的数据库 |

**示例：**

```bash
# 仅创建空数据库
node querybuilder.js init data/test.db

# 创建并执行迁移
node querybuilder.js init data/test.db --migrate

# 创建、迁移并填充种子数据
node querybuilder.js init data/test.db --migrate --seed

# 强制覆盖现有数据库
node querybuilder.js init data/test.db --force --migrate --seed
```

### open - 打开数据库

打开数据库并进入交互式 REPL 模式。

```bash
node querybuilder.js open <dbfile>
```

**启动时会自动：**

1. 运行环境检查（Node 版本、依赖包、数据目录）
2. 加载数据库元数据
3. 加载持久化数据（历史记录、脚本、模板）
4. 显示数据库信息（表数量、数据目录状态、待执行迁移）
5. 进入交互模式

**示例：**

```bash
node querybuilder.js open data/ecommerce.db
```

### migrate - 迁移管理

管理数据库迁移。

```bash
node querybuilder.js migrate <subcommand> [dbfile]
```

**子命令：**

| 子命令 | 说明 |
|--------|------|
| `create <name>` | 创建新的迁移文件 |
| `up` | 执行所有待处理的迁移 |
| `down` | 回滚最后一个迁移 |
| `status` | 查看迁移状态 |

**示例：**

```bash
# 查看迁移状态
node querybuilder.js migrate status data/ecommerce.db

# 执行迁移
node querybuilder.js migrate up data/ecommerce.db

# 回滚迁移
node querybuilder.js migrate down data/ecommerce.db

# 创建新迁移
node querybuilder.js migrate create add_users_table
```

**迁移文件格式：**

迁移文件位于 `migrations/` 目录，文件名格式为 `时间戳_名称.js`。

```javascript
exports.up = async function(helper) {
  // 使用 helper 对象操作数据库
  await helper.createTable('users', {
    id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
    name: 'TEXT NOT NULL',
    email: 'TEXT UNIQUE NOT NULL'
  });
  await helper.addIndex('users', 'email');
};

exports.down = async function(helper) {
  // 回滚逻辑，与 up 相反
  await helper.dropIndex('idx_users_email');
  await helper.dropTable('users');
};
```

**Helper API：**

| 方法 | 说明 |
|------|------|
| `createTable(name, columns)` | 创建表 |
| `dropTable(name)` | 删除表 |
| `renameTable(oldName, newName)` | 重命名表 |
| `addColumn(table, column, definition)` | 添加列 |
| `dropColumn(table, column)` | 删除列 |
| `addIndex(table, columns, [name])` | 添加索引 |
| `dropIndex(name)` | 删除索引 |
| `raw(sql, [params])` | 执行原生 SQL |

## 交互式 REPL

打开数据库后进入交互模式，提示符为 `db>`。

输入 `help` 查看所有可用命令。

### 数据库探索

| 命令 | 说明 |
|------|------|
| `tables` | 列出所有表 |
| `describe <table>` | 显示表结构（列、类型、约束、外键） |
| `sample <table>` | 显示前 10 行数据 |
| `count <table>` | 显示表的行数 |
| `info` 或 `status` | 显示数据库和数据目录的完整状态信息 |

**示例：**

```
db> tables
db> describe users
db> sample products
db> count orders
db> info
```

### 链式查询

使用 `db.<表名>` 开头进行链式查询构建。

**基础查询：**

```javascript
// 查询所有列
db.users

// 指定列
db.users.select('name', 'email', 'age')

// 条件查询
db.users.where('age > ?', 25)
db.users.where('city = ?', '北京').where('age > ?', 20)

// 排序
db.users.orderBy('name')
db.users.orderBy('age', 'DESC')

// 分页
db.users.limit(10).offset(20)

// 聚合函数
db.users.count()
db.orders.sum('total')
db.orders.avg('total')
db.products.min('price')
db.products.max('price')

// 分组
db.orders.groupBy('status').count().sum('total')
```

**联表查询：**

```javascript
// 自动检测外键关联
db.orders.join('users').select('users.name', 'orders.total')

// 手动指定关联条件
db.orders.join('users', 'orders.user_id = users.id')

// 左连接
db.users.leftJoin('orders').select('users.name', 'orders.total')

// 多表连接
db.order_items
  .join('orders')
  .join('products')
  .select('orders.id', 'products.name', 'order_items.quantity')
```

**子查询：**

```javascript
// WHERE IN 子查询
const subQuery = db.orders.where('status = ?', 'paid').select('user_id');
db.users.whereIn('id', subQuery);
```

### 数据操作

**插入：**

```javascript
// 单条插入
db.users.insert({ name: '张三', email: 'zhangsan@example.com', age: 25 })

// 批量插入
db.users.bulkInsert([
  { name: '李四', email: 'lisi@example.com' },
  { name: '王五', email: 'wangwu@example.com' }
])

// 插入或更新 (Upsert)
db.users.upsert(
  { email: 'zhangsan@example.com' },  // 冲突键
  { name: '张三三', age: 26 }          // 更新内容
)
```

**更新：**

```javascript
db.users.where('id = ?', 1).update({ age: 26, city: '上海' })
```

**删除：**

```javascript
db.users.where('id = ?', 1).delete()
```

### 查询模板

创建可复用的参数化查询模板。

| 命令 | 说明 |
|------|------|
| `template create <name> <query>` | 创建模板 |
| `template run <name> [--param=value...]` | 执行模板 |
| `template list` | 列出所有模板 |

**示例：**

```sql
db> template create user_by_city SELECT * FROM users WHERE city = :city
db> template run user_by_city --city=北京
db> template list
```

模板支持 `:paramName` 形式的参数占位符。

### 脚本与历史

| 命令 | 说明 |
|------|------|
| `save <name> <query>` | 保存查询脚本 |
| `run <name>` | 执行保存的脚本 |
| `scripts` | 列出所有保存的脚本 |
| `history` | 显示查询历史 |
| `.read <file>` | 执行 SQL 或 JS 文件 |

**示例：**

```
db> save top_users db.users.orderBy('age', 'DESC').limit(10)
db> run top_users
db> scripts
db> history
db> .read queries.sql
```

**数据导出：**

在链式查询后可调用导出方法：

```javascript
// 导出 CSV
db.users.limit(10).export('csv', 'users.csv')

// 导出 JSON
db.users.limit(10).export('json', 'users.json')

// 导出 Markdown
db.users.limit(10).export('md', 'users.md')
```

### 事务与批量操作

| 命令 | 说明 |
|------|------|
| `begin` | 开始事务 |
| `commit` | 提交事务 |
| `rollback` | 回滚事务 |
| `batch [query1, query2, ...]` | 批量原子操作 |

**示例：**

```
db> begin
db> db.users.insert({ name: 'test', email: 'test@test.com' })
db> rollback
```

批量操作（自动事务）：

```
db> batch [
  "INSERT INTO users (name, email) VALUES ('a', 'a@a.com')",
  "INSERT INTO users (name, email) VALUES ('b', 'b@b.com')"
]
```

### 查询优化分析

| 命令 | 说明 |
|------|------|
| `explain <query>` | 查看查询执行计划 |
| `suggest` | 自动建议缺失的索引 |
| `slow [threshold]` | 显示慢查询（默认 100ms） |

**示例：**

```
db> explain db.users.where('age > ?', 25).orderBy('name')
db> suggest
db> slow 200
```

### 文档与ER图

| 命令 | 说明 |
|------|------|
| `schema [-o file.dot]` | 生成 ER 图（DOT 格式） |
| `doc [-o file.md]` | 生成数据库文档（Markdown） |

**示例：**

```
db> schema -o schema.dot
db> doc -o database.md
```

## 数据持久化

### 数据目录

每个数据库文件都有一个配套的数据目录，位于数据库文件同目录下，命名为 `<数据库名>.data/`。

**示例：**
- 数据库：`data/ecommerce.db`
- 数据目录：`data/ecommerce.data/`

### 存储内容

数据目录包含以下文件：

| 文件 | 说明 |
|------|------|
| `history.json` | 查询历史记录（最多 200 条） |
| `scripts.json` | 保存的查询脚本 |
| `templates.json` | 查询模板 |
| `meta.json` | 元数据（创建时间、最后打开时间） |

### 为什么使用数据目录？

**解决数据漂移问题：**
旧版本的持久化文件（`.query_history.json` 等）存储在当前工作目录下，导致：
- 在不同目录运行时看到不同的历史记录
- 多个数据库共享同一份历史，造成数据混乱
- 数据库文件和其状态数据分离，不便迁移

**新版设计：**
- 每个数据库有独立的配套数据目录
- 数据始终与数据库文件在一起
- 复制/移动数据库时，数据目录一并迁移即可恢复完整状态

### 备份与恢复

**备份：**

```bash
# 备份数据库和其所有状态数据
cp -r data/ecommerce.db data/ecommerce.data/ backup/
```

**恢复：**

```bash
# 将备份放回原位即可恢复完整状态
cp -r backup/ecommerce.db backup/ecommerce.data/ data/
```

## 常见问题

### Q: 如何从旧版本迁移数据？

旧版本的持久化文件（`.query_history.json`、`.saved_scripts.json`、`.query_templates.json`）在当前工作目录下。可以手动将内容复制到新的数据目录对应文件中。

### Q: 为什么运行时提示环境检查失败？

常见原因：
- Node.js 版本过低（需要 >= 14.0.0）
- 依赖包未安装，运行 `npm install`
- 数据目录无写入权限

### Q: 如何重置查询历史？

删除数据目录中的 `history.json` 文件，或在 REPL 中无法直接清空时手动删除。

### Q: 支持哪些 SQLite 特性？

支持 SQLite 标准功能，包括：
- 基础 CRUD 操作
- 事务支持
- 索引管理
- 外键约束（需手动启用）
- 子查询和连接查询
- EXPLAIN 查询计划

### Q: 可以连接远程数据库吗？

不可以，本工具仅支持本地 SQLite 数据库文件。

### Q: 数据目录里的文件可以手动编辑吗？

可以，但建议通过 CLI 命令进行操作。手动编辑时请注意 JSON 格式正确性。
