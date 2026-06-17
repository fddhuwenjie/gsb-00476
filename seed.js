const path = require('path');
const Database = require('./lib/db');
const { seed } = require('./lib/seed');

const dbFile = process.argv[2] || 'ecommerce.db';

async function main() {
  const db = new Database();
  await db.open(dbFile);
  await seed(db);
  await db.close();
}

main().catch(err => {
  console.error('Seed 失败:', err.message);
  process.exit(1);
});
