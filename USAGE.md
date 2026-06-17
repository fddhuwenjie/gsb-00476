# SQLite 查询构建器 CLI — 使用说明

## 快速开始

```bash
# 安装依赖
npm install

# 一键初始化数据库（创建 + 迁移 + 填充示例数据）
node querybuilder.js init ecommerce.db --seed

# 打开交互式 REPL
node querybuilder.js open ecommerce.db
```

## 命令总览

```
node querybuilder.js <命令> <数据库> [选项]
```

| 命令 | 说明 | 示例 |
|------|------|------|
| `init` | 初始化数据库（创建 + 迁移 + 可选填充） | `node querybuilder.js init my.db --seed` |
| `open` | 打开数据库进入交互式 REPL | `node querybuilder.js open my.db` |
| `migrate` | 执行迁移（不进入 REPL） | `node querybuilder.js migrate my.db up` |
| `seed` | 填充示例数据 | `node querybuilder.js seed my.db` |
| `status` | 查看数据库状态 | `node querybuilder.js status my.db` |

## 详细用法

### 1. 初始化数据库

```bash
# 创建空数据库并执行所有待运行的迁移
node querybuilder.js init myapp.db

# 创建数据库 + 迁移 + 填充示例数据
node querybuilder.js init myapp.db --seed

# 强制重建（删除已有数据库后重新初始化）
node querybuilder.js init myapp.db --force --seed
```

`init` 会依次执行：
1. 检查数据库文件是否已存在（`--force` 时删除重建）
2. 创建 SQLite 数据库文件
3. 执行 `migrations/` 目录下所有待运行的迁移
4. 若指定 `--seed`，调用 `seed.js` 填充示例数据

### 2. 连接数据库（交互式 REPL）

```bash
node querybuilder.js open myapp.db
```

启动后会显示：
- 数据库文件路径和大小
- 发现的表数量
- 持久化数据目录位置
- 待执行的迁移提醒（如有）

进入 `db>` 提示符后，可使用所有 REPL 命令：

```
db> tables                          # 列出所有表
db> describe users                  # 查看表结构
db> sample users                    # 查看前10行
db> count users                     # 统计行数
db> db.users.where("age > ?", 25).limit(10)   # 链式查询
db> help                            # 查看完整帮助
db> exit                            # 退出
```

### 3. 执行迁移

```bash
# 执行所有待运行的迁移
node querybuilder.js migrate myapp.db up

# 回滚最后一次迁移
node querybuilder.js migrate myapp.db down

# 查看迁移状态
node querybuilder.js migrate myapp.db status

# 创建新的迁移文件
node querybuilder.js migrate myapp.db create add_users_age_index
```

迁移文件存放在项目目录的 `migrations/` 下，格式为 `<时间戳>_<名称>.js`：

```javascript
exports.up = async function(helper) {
  await helper.createTable('tags', {
    id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
    name: 'TEXT NOT NULL UNIQUE'
  });
};

exports.down = async function(helper) {
  await helper.dropTable('tags');
};
```

迁移 helper 提供的方法：
- `createTable(name, columns)` / `dropTable(name)`
- `addColumn(table, column, def)` / `dropColumn(table, column)`
- `addIndex(table, columns, name?)` / `dropIndex(name)`
- `renameTable(oldName, newName)`
- `raw(sql, params?)`

### 4. 填充数据

```bash
# 通过 CLI 命令填充
node querybuilder.js seed myapp.db

# 或直接运行 seed.js（独立模式，会重建数据库）
node seed.js myapp.db
```

### 5. 查看状态

```bash
node querybuilder.js status myapp.db
```

输出示例：
```
数据库状态:
  路径: /path/to/myapp.db
  大小: 0.15 MB
  修改时间: 2024-01-15T10:30:00.000Z
  表数量: 4
  数据目录: ~/.querybuilder/data/a1b2c3d4e5f6g7h8

表列表:
  users: 100 行, 7 列
  products: 100 行, 7 列
  orders: 100 行, 6 列
  order_items: 300 行, 6 列

迁移文件         状态      应用时间
20260615...     已应用     2024-01-15T10:30:00.000Z
```

## 持久化数据目录

历史记录、保存的脚本、查询模板等持久化数据统一存放在固定目录中，**不再跟随工作目录漂移**：

```
~/.querybuilder/
  └── data/
      ├── a1b2c3d4e5f6g7h8/    # 数据库 A 的数据（路径哈希）
      │   ├── history.json
      │   ├── scripts.json
      │   └── templates.json
      └── i9j0k1l2m3n4o5p6/    # 数据库 B 的数据
          ├── history.json
          ├── scripts.json
          └── templates.json
```

### 自定义数据目录

通过环境变量 `QB_DATA_DIR` 覆盖默认位置：

```bash
export QB_DATA_DIR=/data/querybuilder
node querybuilder.js open myapp.db
```

### 旧版数据迁移

首次使用新版本时，如果当前目录下存在旧版持久化文件（`.query_history.json`、`.saved_scripts.json`、`.query_templates.json`），会自动迁移到新目录，无需手动操作。

## 状态恢复

### 数据库损坏恢复

```bash
# 1. 检查数据库状态
node querybuilder.js status myapp.db

# 2. 如果数据库损坏，强制重建
node querybuilder.js init myapp.db --force --seed

# 3. 重新打开
node querybuilder.js open myapp.db
```

### 迁移回滚与重做

```bash
# 回滚最后一次迁移
node querybuilder.js migrate myapp.db down

# 重新执行所有待运行迁移
node querybuilder.js migrate myapp.db up
```

### 清除持久化数据

持久化数据存储在 `~/.querybuilder/data/<hash>/` 下，可直接删除对应目录：

```bash
# 查看数据目录位置
node querybuilder.js status myapp.db

# 删除该数据库的持久化数据
rm -rf ~/.querybuilder/data/<hash>/
```

## npm scripts 快捷方式

```bash
npm run init     # 等同于 node querybuilder.js init（需补充数据库名参数）
npm run open     # 等同于 node querybuilder.js open（需补充数据库名参数）
npm run migrate  # 等同于 node querybuilder.js migrate（需补充参数）
npm run seed     # 等同于 node querybuilder.js seed（需补充数据库名参数）
npm run status   # 等同于 node querybuilder.js status（需补充数据库名参数）
npm run demo     # 一键初始化 ecommerce.db 并填充示例数据
```

注意：`npm run` 需要通过 `--` 传递额外参数，例如：

```bash
npm run open -- ecommerce.db
npm run init -- myapp.db --seed
```
