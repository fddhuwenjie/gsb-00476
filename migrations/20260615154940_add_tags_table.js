exports.up = async function(helper) {
  await helper.createTable('tags', {
    id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
    name: 'TEXT NOT NULL UNIQUE',
    color: 'TEXT DEFAULT "#cccccc"',
    created_at: 'TEXT DEFAULT CURRENT_TIMESTAMP'
  });

  await helper.createTable('product_tags', {
    product_id: 'INTEGER NOT NULL',
    tag_id: 'INTEGER NOT NULL',
    created_at: 'TEXT DEFAULT CURRENT_TIMESTAMP'
  });

  await helper.addIndex('product_tags', ['product_id', 'tag_id'], 'idx_product_tags_unique');
};

exports.down = async function(helper) {
  await helper.dropIndex('idx_product_tags_unique');
  await helper.dropTable('product_tags');
  await helper.dropTable('tags');
};
