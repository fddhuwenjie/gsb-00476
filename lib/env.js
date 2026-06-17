const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const MIN_NODE_VERSION = '14.0.0';
const REQUIRED_PACKAGES = ['sqlite3', 'chalk', 'cli-table3'];

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

function checkNodeVersion() {
  const current = process.version.replace('v', '');
  const ok = compareVersions(current, MIN_NODE_VERSION) >= 0;
  return {
    ok,
    current: process.version,
    required: `>= v${MIN_NODE_VERSION}`,
    message: ok
      ? `Node.js 版本检查通过: ${process.version}`
      : `Node.js 版本过低: 当前 ${process.version}, 需要 >= v${MIN_NODE_VERSION}`
  };
}

function checkDependencies() {
  const projectRoot = path.resolve(__dirname, '..');
  const pkgPath = path.join(projectRoot, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    return { ok: false, message: '未找到 package.json' };
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const missing = REQUIRED_PACKAGES.filter(p => !deps[p]);

    if (missing.length > 0) {
      return {
        ok: false,
        message: `缺少依赖包: ${missing.join(', ')}，请运行 npm install`,
        missing
      };
    }

    const failed = [];
    for (const pkgName of REQUIRED_PACKAGES) {
      try {
        require.resolve(pkgName, { paths: [projectRoot] });
      } catch (e) {
        failed.push(pkgName);
      }
    }

    if (failed.length > 0) {
      return {
        ok: false,
        message: `依赖未安装: ${failed.join(', ')}，请运行 npm install`,
        missing: failed
      };
    }

    return { ok: true, message: '依赖检查通过' };
  } catch (e) {
    return { ok: false, message: `解析 package.json 失败: ${e.message}` };
  }
}

function checkWritableDir(dirPath) {
  try {
    const testFile = path.join(dirPath, `.write_test_${Date.now()}`);
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    return { ok: true, message: `目录可写: ${dirPath}` };
  } catch (e) {
    return { ok: false, message: `目录不可写: ${dirPath} - ${e.message}` };
  }
}

function runStartupChecks(dataDir) {
  const results = [];

  results.push({ name: 'Node.js 版本', ...checkNodeVersion() });
  results.push({ name: '依赖包', ...checkDependencies() });

  if (dataDir) {
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
        results.push({ name: '数据目录', ok: true, message: `已创建数据目录: ${dataDir}` });
      } catch (e) {
        results.push({ name: '数据目录', ok: false, message: `无法创建数据目录: ${e.message}` });
      }
    } else {
      results.push({ name: '数据目录', ...checkWritableDir(dataDir) });
    }
  }

  const allOk = results.every(r => r.ok);

  return {
    ok: allOk,
    results
  };
}

function printCheckResults(results) {
  console.log(chalk.bold('\n环境检查:'));
  results.forEach(r => {
    const icon = r.ok ? chalk.green('✓') : chalk.red('✗');
    console.log(`  ${icon} ${r.name}: ${r.message}`);
  });
  console.log();
}

module.exports = {
  checkNodeVersion,
  checkDependencies,
  checkWritableDir,
  runStartupChecks,
  printCheckResults,
  MIN_NODE_VERSION
};
