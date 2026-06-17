exports.up = async function(helper) {
  await helper.createTable('tags', {
    id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
    name: 'TEXT NOT NULL UNIQUE',
    description: 'TEXT',
    created_at: 'TEXT DEFAULT CURRENT_TIMESTAMP'
  });

  await helper.raw(`CREATE TABLE IF NOT EXISTS product_tags (
    product_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (product_id, tag_id)
  )`);

  await helper.addIndex('product_tags', 'product_id', 'idx_product_tags_product_id');
  await helper.addIndex('product_tags', 'tag_id', 'idx_product_tags_tag_id');
};

exports.down = async function(helper) {
  await helper.dropTable('product_tags');
  await helper.dropTable('tags');
};
