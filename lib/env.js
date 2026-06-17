const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0]);
  const minor = parseInt(process.versions.node.split('.')[1]);
  const requiredMajor = 14;

  if (major < requiredMajor) {
    console.log(chalk.red(`✗ Node.js 版本过低: v${process.versions.node}`));
    console.log(chalk.yellow(`  需要 Node.js v${requiredMajor}.0 或更高版本`));
    console.log(chalk.gray(`  请访问 https://nodejs.org/ 升级`));
    return false;
  }

  return true;
}

function checkDependencies(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.log(chalk.red('✗ 未找到 package.json'));
    return false;
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  const nodeModulesPath = path.join(projectRoot, 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    console.log(chalk.red('✗ 未找到 node_modules 目录'));
    console.log(chalk.yellow('  请先运行: npm install'));
    return false;
  }

  const requiredDeps = ['sqlite3', 'chalk', 'cli-table3'];
  const missing = [];

  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      missing.push(dep);
      continue;
    }
    const depPath = path.join(nodeModulesPath, dep);
    if (!fs.existsSync(depPath)) {
      missing.push(dep);
    }
  }

  if (missing.length > 0) {
    console.log(chalk.red(`✗ 缺少依赖: ${missing.join(', ')}`));
    console.log(chalk.yellow('  请运行: npm install'));
    return false;
  }

  return true;
}

function checkMigrationsDir(migrationsDir) {
  if (!fs.existsSync(migrationsDir)) {
    console.log(chalk.yellow(`⚠ 迁移目录不存在: ${migrationsDir}`));
    console.log(chalk.gray('  将在首次创建迁移时自动创建'));
    return false;
  }

  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.js'));
  return files.length > 0;
}

function checkDbFile(dbPath) {
  const resolved = path.resolve(dbPath);
  const exists = fs.existsSync(resolved);

  return {
    path: resolved,
    exists,
    isNew: !exists,
    size: exists ? fs.statSync(resolved).size : 0,
    dir: path.dirname(resolved),
    basename: path.basename(resolved)
  };
}

function printStartupBanner(dbInfo, migrationStatus) {
  console.log(chalk.bold.cyan('\n┌─────────────────────────────────────────┐'));
  console.log(chalk.bold.cyan('│   SQLite Query Builder CLI              │'));
  console.log(chalk.bold.cyan('└─────────────────────────────────────────┘'));
  console.log();
  console.log(`  ${chalk.bold('数据库:')} ${dbInfo.path}`);
  console.log(`  ${chalk.bold('状态:')} ${dbInfo.exists ? chalk.green('已存在') : chalk.yellow('新创建')}`);
  if (dbInfo.exists) {
    console.log(`  ${chalk.bold('大小:')} ${(dbInfo.size / 1024).toFixed(2)} KB`);
  }
  console.log(`  ${chalk.bold('数据目录:')} ${dbInfo.path}.data/`);

  if (migrationStatus) {
    console.log(`  ${chalk.bold('迁移:')} ${migrationStatus.applied}/${migrationStatus.total} 已应用`);
    if (migrationStatus.pending > 0) {
      console.log(chalk.yellow(`  ⚠ 有 ${migrationStatus.pending} 个待执行的迁移 (运行 migrate up)`));
    }
  }
  console.log();
}

function runAllChecks(projectRoot, dbPath, migrationsDir) {
  let allPassed = true;

  if (!checkNodeVersion()) {
    allPassed = false;
  }

  if (!checkDependencies(projectRoot)) {
    allPassed = false;
  }

  return allPassed;
}

module.exports = {
  checkNodeVersion,
  checkDependencies,
  checkMigrationsDir,
  checkDbFile,
  printStartupBanner,
  runAllChecks
};
