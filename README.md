# SQLite 查询构建器 CLI

基于 SQLite 的交互式查询构建工具，提供链式 API、数据库迁移、查询模板、慢查询分析等功能。

## 目录结构

```
.
├── querybuilder.js    # 主程序入口
├── seed.js            # 种子数据脚本
├── migrations/        # 数据库迁移文件
├── data/              # 数据库文件目录 (默认)
├── .qb/               # 持久化数据目录 (历史/脚本/模板)
├── package.json
└── README.md
```

## 环境要求

- Node.js >= 14.0.0
- npm 或 yarn

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 初始化项目

```bash
npm run init
# 或
node querybuilder.js init
```

初始化会创建以下目录：
- `data/` - 数据库文件默认存放位置
- `.qb/` - 查询历史、保存的脚本、模板等持久化数据
- `migrations/` - 数据库迁移文件

### 3. 生成示例数据

```bash
npm run seed
# 或
node querybuilder.js seed ecommerce.db
```

### 4. 进入交互式 REPL

```bash
npm start
# 或
node querybuilder.js open ecommerce.db
```

## 命令大全

### 环境检查

```bash
npm run env
# 或
node querybuilder.js env
```

检查 Node.js 版本、依赖完整性、目录结构等。

### 数据库操作

#### 打开数据库

```bash
node querybuilder.js open <database>
node querybuilder.js repl <database>
```

- 如果数据库文件名不包含路径分隔符，默认存放在 `data/` 目录
- 支持相对路径和绝对路径
- 数据库不存在时会自动创建

#### 初始化项目

```bash
node querybuilder.js init
```

创建必要的目录结构并检查环境。

#### 种子数据

```bash
node querybuilder.js seed <database>
```

执行 `seed.js` 生成示例数据（电商场景：用户、商品、订单、订单项）。

### 数据库迁移

迁移文件存放在 `migrations/` 目录，文件名格式为 `时间戳_名称.js`。

#### 创建迁移

```bash
node querybuilder.js migrate create <名称>
```

#### 执行迁移

```bash
node querybuilder.js migrate up <database>
```

#### 回滚迁移

```bash
node querybuilder.js migrate down <database>
```

#### 查看迁移状态

```bash
node querybuilder.js migrate status <database>
```

#### 迁移文件格式

```javascript
exports.up = async function(helper) {
  await helper.createTable('tags', {
    id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
    name: 'TEXT NOT NULL UNIQUE',
    created_at: 'TEXT DEFAULT CURRENT_TIMESTAMP'
  });
};

exports.down = async function(helper) {
  await helper.dropTable('tags');
};
```

迁移辅助对象 `helper` 提供的方法：
- `createTable(name, columns)` - 创建表
- `dropTable(name)` - 删除表
- `addColumn(table, column, definition)` - 添加列
- `dropColumn(table, column)` - 删除列
- `addIndex(table, columns, [name])` - 添加索引
- `dropIndex(name)` - 删除索引
- `renameTable(oldName, newName)` - 重命名表
- `raw(sql, [params])` - 执行原始 SQL

## 交互式 REPL 命令

进入 REPL 后，可以使用以下命令：

### 数据库探索

| 命令 | 说明 |
|------|------|
| `tables` | 列出所有表 |
| `describe <table>` | 显示表结构 |
| `sample <table>` | 显示前10行数据 |
| `count <table>` | 显示行数 |

### 链式查询

使用 `db.<表名>` 开始链式查询：

```javascript
// 基本查询
db.users.where("age > ?", 25).select("name", "email").orderBy("name").limit(10)

// 关联查询
db.orders.join("users").select("users.name", "orders.total").limit(5)

// 聚合查询
db.orders.groupBy("status").count().sum("total").avg("total")

// 子查询
db.users.whereIn("id", db.orders.select("user_id").where("status = ?", "paid"))
```

常用链式方法：
- `select(...columns)` - 指定查询列
- `where(condition, ...params)` - WHERE 条件
- `orWhere(condition, ...params)` - OR 条件
- `whereIn(column, values)` - IN 条件
- `whereNull(column)` / `whereNotNull(column)` - NULL 判断
- `whereBetween(column, min, max)` - BETWEEN 条件
- `join(table, [condition])` / `leftJoin()` / `rightJoin()` - 表连接
- `orderBy(column, [direction])` - 排序
- `groupBy(...columns)` - 分组
- `having(condition, ...params)` - HAVING 条件
- `limit(n)` / `offset(n)` - 分页
- `count()` / `sum()` / `avg()` / `min()` / `max()` - 聚合函数

### 数据操作

```javascript
// 插入
db.users.insert({name: "张三", age: 30})

// 更新
db.users.where("id = ?", 1).update({age: 31})

// 删除
db.users.where("id = ?", 1).delete()

// 插入或更新
db.users.upsert({email: "x@x.com"}, {name: "新名字"})

// 批量插入
db.users.bulkInsert([{name: "A"}, {name: "B"}])
```

### 事务与批量操作

| 命令 | 说明 |
|------|------|
| `begin` | 开始事务 |
| `commit` | 提交事务 |
| `rollback` | 回滚事务 |
| `batch [query1, ...]` | 批量执行（原子操作） |

### 查询分析与优化

| 命令 | 说明 |
|------|------|
| `explain <chain-query>` | 查看查询执行计划 |
| `suggest` | 建议缺失的索引 |
| `slow [threshold]` | 显示慢查询（默认100ms） |

### ER图与文档

| 命令 | 说明 |
|------|------|
| `schema [-o file.dot]` | 生成 ER 图（DOT格式） |
| `doc [-o file.md]` | 生成数据库文档（Markdown） |

### 查询模板

| 命令 | 说明 |
|------|------|
| `template create <name> <query>` | 创建参数化模板 |
| `template run <name> --param1=val1 ...` | 执行模板 |
| `template list` | 列出所有模板 |

模板支持 `:param` 形式的参数占位符，以及 `{{template_name}}` 形式的模板嵌套引用。

### 导出与脚本

| 命令 | 说明 |
|------|------|
| `export csv <file> <query>` | 导出为 CSV |
| `export json <file> <query>` | 导出为 JSON |
| `export md <file> <query>` | 导出为 Markdown |
| `save <name> <query>` | 保存脚本 |
| `run <name>` | 执行保存的脚本 |
| `scripts` | 列出保存的脚本 |
| `history` | 显示查询历史 |
| `.read <file>` | 批量执行文件（.sql 或 .js） |

### 其他

| 命令 | 说明 |
|------|------|
| `help` | 显示帮助 |
| `exit` / `quit` / `.exit` | 退出程序 |

## 持久化数据说明

所有持久化数据统一存放在项目根目录的 `.qb/` 目录下：

- `history.json` - 查询历史（最多保留100条）
- `scripts.json` - 保存的脚本
- `templates.json` - 查询模板
- `config.json` - 配置信息（上次使用的数据库等）

> **重要**：持久化目录基于 `__dirname` 定位，与工作目录无关。无论在哪个目录下运行命令，数据都会保存到项目的 `.qb/` 目录中，避免了数据污染问题。

数据库文件默认存放在 `data/` 目录下，也可以通过绝对路径或相对路径指定其他位置。

## 恢复状态

项目状态完全由以下文件/目录决定：

1. **数据库文件**（`data/*.db`）- 数据表和数据
2. **持久化目录**（`.qb/`）- 查询历史、脚本、模板
3. **迁移文件**（`migrations/`）- 数据库结构变更历史

如需迁移到新环境：

```bash
# 1. 复制项目代码
git clone <repo>
cd <project>

# 2. 安装依赖
npm install

# 3. 复制数据库文件到 data/ 目录
cp /path/to/your.db data/

# 4. 复制 .qb/ 目录（可选，恢复历史/脚本/模板）
cp -r /path/to/.qb ./

# 5. 初始化检查
npm run init

# 6. 打开数据库
npm start
```

## 常见问题

### Q: 为什么我的历史记录不见了？

A: 检查是否在正确的项目目录下运行。持久化数据存放在项目的 `.qb/` 目录中，每个项目独立保存。

### Q: 如何更换默认数据库？

A: 修改 `.qb/config.json` 中的 `lastDb` 字段，或者在启动时指定数据库文件路径。

### Q: 迁移执行失败怎么办？

A: 迁移执行失败时会停止在出错的迁移文件，已执行的迁移不会自动回滚。可以使用 `migrate down` 手动回滚，修复后重新执行。

### Q: 支持哪些 SQLite 特性？

A: 支持标准的 SQLite SQL 语法，包括外键约束、事务、索引等。可以直接在 REPL 中输入原生 SQL 语句执行。

## License

ISC
