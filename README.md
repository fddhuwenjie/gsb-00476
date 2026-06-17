# SQLite Query Builder CLI

基于 SQLite 的交互式查询构建器，提供链式调用 API、数据库迁移、种子数据填充、查询模板等功能的命令行工具。

## 特性

- **链式查询构建器**：类 Knex 风格的链式 API，支持 SELECT/INSERT/UPDATE/DELETE/UPSERT/批量插入
- **交互式 REPL**：实时编写和执行查询，带语法高亮的表格输出
- **数据库迁移**：版本化的 schema 迁移系统，支持 up/down/status/create
- **种子数据**：内置电商示例数据生成器
- **查询模板**：支持参数化模板和模板嵌套引用
- **持久化存储**：查询历史、保存脚本、模板随数据库文件存储，不随工作目录漂移
- **查询分析**：EXPLAIN 执行计划、索引建议、慢查询统计
- **ER 图与文档**：一键生成数据库 ER 图（DOT 格式）和 Markdown 文档

## 环境要求

- Node.js >= 14.0.0
- npm 或 yarn

## 安装

```bash
# 克隆项目后安装依赖
npm install
```

全局安装（可选）：

```bash
npm link
# 之后可直接使用 qbuilder 命令
qbuilder help
```

## 快速开始

### 1. 初始化数据库

创建数据库并执行所有迁移：

```bash
node querybuilder.js init ecommerce.db
```

或使用 npm script：

```bash
npm run init
```

### 2. 填充示例数据（可选）

```bash
node querybuilder.js seed ecommerce.db
```

或：

```bash
npm run seed
```

### 3. 打开交互式 REPL

```bash
node querybuilder.js open ecommerce.db
```

或：

```bash
npm run open
```

进入 REPL 后输入 `help` 查看所有可用命令。

## 命令参考

### init - 初始化数据库

创建数据库文件并执行所有待执行的迁移。

```bash
node querybuilder.js init <dbfile>
```

**示例：**
```bash
node querybuilder.js init myapp.db
```

### open - 打开交互式 REPL

连接数据库并进入交互式命令行界面。

```bash
node querybuilder.js open <dbfile>
```

启动时会显示：
- 数据库路径、大小、状态
- 数据表数量
- 迁移状态（待执行迁移提示）
- 数据目录位置

### migrate - 数据库迁移

```bash
node querybuilder.js migrate <dbfile> <subcommand>
```

**子命令：**

| 子命令 | 说明 |
|--------|------|
| `up` | 执行所有待执行的迁移 |
| `down` | 回滚最后一次迁移 |
| `status` | 查看迁移状态 |
| `create <名称>` | 创建新的迁移文件 |

**示例：**

```bash
# 执行迁移
node querybuilder.js migrate ecommerce.db up

# 查看迁移状态
node querybuilder.js migrate ecommerce.db status

# 创建新迁移
node querybuilder.js migrate ecommerce.db create add_users_table
```

迁移文件位于 `migrations/` 目录，命名格式为 `时间戳_名称.js`。

**迁移文件结构：**

```javascript
exports.up = async function(helper) {
  // 升级逻辑
  await helper.createTable('users', {
    id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
    name: 'TEXT NOT NULL',
    email: 'TEXT UNIQUE NOT NULL'
  });
};

exports.down = async function(helper) {
  // 回滚逻辑
  await helper.dropTable('users');
};
```

**迁移 Helper API：**

| 方法 | 说明 |
|------|------|
| `createTable(name, columns)` | 创建表，支持 `_constraints` 数组定义表级约束 |
| `dropTable(name)` | 删除表 |
| `addColumn(table, column, definition)` | 添加列 |
| `dropColumn(table, column)` | 删除列 |
| `addIndex(table, columns, name?)` | 创建索引 |
| `dropIndex(name)` | 删除索引 |
| `renameTable(oldName, newName)` | 重命名表 |
| `raw(sql, params?)` | 执行原生 SQL |
| `insert(table, data)` | 插入单条数据 |

### seed - 填充种子数据

向已有数据库填充示例数据。

```bash
node querybuilder.js seed <dbfile>
```

根据数据库中已有的表自动填充对应的示例数据：
- `users` 表：100 个随机用户
- `products` 表：100 个随机商品
- `orders` / `order_items` 表：100 个订单及订单项
- `tags` / `product_tags` 表：10 个标签及商品标签关联

### status - 查看数据库状态

显示数据库文件信息、表列表、行数统计和迁移状态。

```bash
node querybuilder.js status <dbfile>
```

### help - 显示帮助

```bash
node querybuilder.js help
```

## 交互式 REPL 使用指南

启动 REPL 后，输入以下类型的命令：

### 数据库探索

```
tables              - 列出所有表
describe <table>    - 显示表结构（列、类型、约束、外键）
sample <table>      - 显示前 10 行数据
count <table>       - 显示表行数
```

### 链式查询

使用 `db.<表名>` 开始构建查询：

```javascript
// 基本查询
db.users.where("age > ?", 25).select("name", "email").orderBy("name").limit(10)

// JOIN 查询（自动检测外键关联）
db.orders.join("users").select("users.name", "orders.total").limit(5)

// 聚合查询
db.orders.groupBy("status").count().sum("total").avg("total")

// 子查询
db.users.whereIn("id", db.orders.select("user_id").where("status = ?", "paid"))

// INSERT
db.users.insert({name: "张三", age: 30, email: "zhangsan@example.com"})

// UPDATE
db.users.where("id = ?", 1).update({age: 31})

// DELETE
db.users.where("id = ?", 1).delete()

// UPSERT
db.users.upsert({email: "x@x.com"}, {name: "新名字"})

// 批量插入
db.users.bulkInsert([{name: "A"}, {name: "B"}])
```

### 迁移管理

```
migrate status       - 查看迁移状态
migrate up           - 执行待运行的迁移
migrate down         - 回滚最后一次迁移
migrate create <name> - 创建新迁移文件
```

### 事务与批量操作

```
begin                - 开始事务
commit               - 提交事务
rollback             - 回滚事务
batch [query1, ...]  - 批量执行（原子操作）
```

### 查询分析与优化

```
explain <链式查询>    - 查看查询执行计划
suggest              - 建议缺失的索引
slow [threshold]     - 显示慢查询（默认 100ms）
```

### ER 图与文档生成

```
schema [-o file.dot]  - 生成 ER 图（DOT 格式）
doc [-o file.md]      - 生成数据库文档（Markdown）
```

### 查询模板

```
template create <name> <query>      - 创建参数化模板（使用 :param）
template run <name> --param=val ... - 执行模板
template list                        - 列出所有模板
```

模板支持嵌套引用（使用 `{{name}}` 引用其他模板）。

### 导出与脚本

```
export csv out.csv db.users.limit(5)   - 导出为 CSV
export json out.json db.users.limit(5) - 导出为 JSON
export md out.md db.users.limit(5)     - 导出为 Markdown
save <name> <query>                    - 保存脚本
run <name>                             - 执行已保存的脚本
scripts                                - 列出保存的脚本
history                                - 显示查询历史
.read <file>                           - 批量执行文件（.sql 或 .js）
```

## 项目结构

```
.
├── querybuilder.js      # CLI 入口文件
├── package.json         # 项目配置
├── migrations/          # 迁移文件目录
│   ├── 20260601000001_initial_schema.js
│   └── 20260615154940_add_tags_table.js
├── lib/                 # 核心模块
│   ├── db.js            # 数据库连接与元数据管理
│   ├── storage.js       # 持久化存储（历史/脚本/模板）
│   ├── migrate.js       # 迁移管理器
│   ├── repl.js          # 交互式 REPL
│   ├── querybuilder.js  # 查询构建器类
│   ├── seed.js          # 种子数据生成器
│   └── env.js           # 环境检查工具
└── seed.js              # 独立种子脚本（向后兼容）
```

## 持久化数据说明

**问题修复**：原版本中，查询历史、保存脚本、模板等文件存储在当前工作目录（`.query_history.json`、`.saved_scripts.json`、`.query_templates.json`），导致在不同目录运行时数据不一致（数据漂移问题）。

**新方案**：所有持久化数据存储在数据库文件同名的 `.data/` 目录中，与数据库文件放在一起：

```
ecommerce.db           # 数据库文件
ecommerce.db.data/     # 持久化数据目录
├── history.json       # 查询历史（最近 100 条）
├── scripts.json       # 保存的脚本
└── templates.json     # 查询模板
```

这样无论从哪个工作目录运行，只要连接的是同一个数据库文件，就能访问到相同的历史记录、脚本和模板。

## 数据恢复与备份

### 备份

直接复制数据库文件和对应的数据目录即可完成完整备份：

```bash
cp -r ecommerce.db ecommerce.db.data/ /path/to/backup/
```

### 恢复

将备份的数据库文件和数据目录放回目标位置即可恢复所有状态：

```bash
cp -r /path/to/backup/ecommerce.db* ./
```

### 仅迁移 schema 和数据

如果只需要迁移数据库内容（不含历史/脚本/模板），只需复制 `.db` 文件即可。

## 常见问题

### 如何添加新的迁移？

```bash
node querybuilder.js migrate ecommerce.db create add_new_table
```

然后编辑 `migrations/` 下新创建的文件，实现 `up` 和 `down` 函数。

### 迁移失败了怎么办？

迁移系统会在失败时停止，已成功的迁移不会回滚。修复导致失败的问题后，重新运行 `migrate up` 即可继续执行剩余迁移。

### 支持哪些 SQLite 特性？

- 标准 SQL 查询
- 外键约束
- 事务（BEGIN/COMMIT/ROLLBACK）
- UPSERT（ON CONFLICT）
- 索引
- EXPLAIN QUERY PLAN

### 可以连接已有的 SQLite 数据库吗？

可以，直接 `open` 已有的 `.db` 文件即可。迁移系统会自动创建 `migrations_log` 表来追踪迁移状态，不会影响现有数据表。

## License

ISC
