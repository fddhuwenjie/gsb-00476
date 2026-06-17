exports.up = async function(helper) {
  await helper.createTable('users', {
    id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
    name: 'TEXT NOT NULL',
    email: 'TEXT UNIQUE NOT NULL',
    phone: 'TEXT',
    age: 'INTEGER',
    city: 'TEXT',
    created_at: 'TEXT DEFAULT CURRENT_TIMESTAMP'
  });

  await helper.createTable('products', {
    id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
    name: 'TEXT NOT NULL',
    category: 'TEXT',
    price: 'REAL NOT NULL',
    stock: 'INTEGER DEFAULT 0',
    description: 'TEXT',
    created_at: 'TEXT DEFAULT CURRENT_TIMESTAMP'
  });

  await helper.createTable('orders', {
    id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
    user_id: 'INTEGER NOT NULL',
    total: 'REAL NOT NULL',
    status: "TEXT DEFAULT 'pending'",
    order_date: 'TEXT NOT NULL',
    _constraints: [
      'FOREIGN KEY (user_id) REFERENCES users(id)'
    ]
  });

  await helper.createTable('order_items', {
    id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
    order_id: 'INTEGER NOT NULL',
    product_id: 'INTEGER NOT NULL',
    quantity: 'INTEGER NOT NULL',
    price: 'REAL NOT NULL',
    _constraints: [
      'FOREIGN KEY (order_id) REFERENCES orders(id)',
      'FOREIGN KEY (product_id) REFERENCES products(id)'
    ]
  });

  await helper.addIndex('orders', 'user_id', 'idx_orders_user_id');
  await helper.addIndex('order_items', 'order_id', 'idx_order_items_order_id');
  await helper.addIndex('order_items', 'product_id', 'idx_order_items_product_id');
  await helper.addIndex('products', 'category', 'idx_products_category');
};

exports.down = async function(helper) {
  await helper.dropTable('order_items');
  await helper.dropTable('orders');
  await helper.dropTable('products');
  await helper.dropTable('users');
};
