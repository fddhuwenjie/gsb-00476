exports.up = async function(helper) {
  await helper.createTable('tags', {
    id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
    name: 'TEXT UNIQUE NOT NULL',
    color: 'TEXT DEFAULT \'#999999\'',
    description: 'TEXT',
    created_at: 'TEXT DEFAULT CURRENT_TIMESTAMP'
  });

  await helper.createTable('product_tags', {
    product_id: 'INTEGER NOT NULL',
    tag_id: 'INTEGER NOT NULL',
    created_at: 'TEXT DEFAULT CURRENT_TIMESTAMP',
    _constraints: [
      'PRIMARY KEY (product_id, tag_id)',
      'FOREIGN KEY (product_id) REFERENCES products(id)',
      'FOREIGN KEY (tag_id) REFERENCES tags(id)'
    ]
  });

  await helper.addIndex('product_tags', 'tag_id', 'idx_product_tags_tag_id');
};

exports.down = async function(helper) {
  await helper.dropTable('product_tags');
  await helper.dropTable('tags');
};
