const firstNames = ['张', '李', '王', '赵', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马', '罗'];
const lastNames = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '洋', '艳', '勇', '军', '杰', '娟', '涛', '明', '超', '秀英', '霞', '平'];
const cities = ['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '西安', '南京', '重庆'];
const productNames = ['智能手机', '笔记本电脑', '蓝牙耳机', '机械键盘', '鼠标', '显示器', '平板电脑', '智能手表', '路由器', '移动电源', '相机', '打印机', '音箱', '耳机', '键盘', '硬盘', '内存条', '显卡', '主板', '机箱'];
const categories = ['电子产品', '数码配件', '计算机设备', '智能家居', '摄影器材', '办公设备'];
const statuses = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];
const tagNames = ['热销', '新品', '推荐', '限时折扣', '满减', '包邮', '赠品', '预售', '秒杀', '会员专享'];

function randomName() {
  return firstNames[Math.floor(Math.random() * firstNames.length)] + lastNames[Math.floor(Math.random() * lastNames.length)];
}

function randomEmail(name) {
  const domains = ['gmail.com', 'qq.com', '163.com', 'outlook.com', 'hotmail.com'];
  return `${name.toLowerCase().replace(/\s/g, '')}${Math.floor(Math.random() * 1000)}@${domains[Math.floor(Math.random() * domains.length)]}`;
}

function randomPhone() {
  return `1${Math.floor(Math.random() * 9) + 3}${Math.floor(Math.random() * 1000000000).toString().padStart(9, '0')}`;
}

function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime())).toISOString().split('T')[0];
}

async function seed(database, options = {}) {
  const userCount = options.userCount || 100;
  const productCount = options.productCount || 100;
  const orderCount = options.orderCount || 100;

  console.log('正在生成示例数据...');

  const tables = Object.keys(database.tableMetadata);
  const hasUsers = tables.includes('users');
  const hasProducts = tables.includes('products');
  const hasOrders = tables.includes('orders');
  const hasOrderItems = tables.includes('order_items');
  const hasTags = tables.includes('tags');
  const hasProductTags = tables.includes('product_tags');

  if (!hasUsers) {
    console.log('警告: 未找到 users 表，跳过用户数据生成');
  }
  if (!hasProducts) {
    console.log('警告: 未找到 products 表，跳过商品数据生成');
  }

  if (hasUsers) {
    console.log(`  生成 ${userCount} 个用户...`);
    const userStmt = database.db.prepare('INSERT INTO users (name, email, phone, age, city, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    for (let i = 1; i <= userCount; i++) {
      const name = randomName();
      userStmt.run(
        name,
        randomEmail(name),
        randomPhone(),
        Math.floor(Math.random() * 50) + 18,
        cities[Math.floor(Math.random() * cities.length)],
        randomDate(new Date(2023, 0, 1), new Date(2024, 5, 30))
      );
    }
    userStmt.finalize();
  }

  let createdProductIds = [];
  if (hasProducts) {
    console.log(`  生成 ${productCount} 个商品...`);
    const productStmt = database.db.prepare('INSERT INTO products (name, category, price, stock, description) VALUES (?, ?, ?, ?, ?)');
    for (let i = 1; i <= productCount; i++) {
      const pname = productNames[Math.floor(Math.random() * productNames.length)];
      const info = productStmt.run(
        `${pname} ${Math.floor(Math.random() * 100)}`,
        categories[Math.floor(Math.random() * categories.length)],
        Math.floor(Math.random() * 5000) + 50,
        Math.floor(Math.random() * 500) + 10,
        `这是一款高品质的${pname}，性能卓越，性价比高。`
      );
      createdProductIds.push(info.lastID);
    }
    productStmt.finalize();
  }

  if (hasTags && hasProducts && hasProductTags) {
    console.log(`  生成 ${tagNames.length} 个标签...`);
    const tagStmt = database.db.prepare('INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)');
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'];
    const tagIds = [];
    tagNames.forEach((name, idx) => {
      const info = tagStmt.run(name, colors[idx % colors.length], new Date().toISOString());
      tagIds.push(info.lastID);
    });
    tagStmt.finalize();

    console.log('  生成商品标签关联...');
    const ptStmt = database.db.prepare('INSERT OR IGNORE INTO product_tags (product_id, tag_id) VALUES (?, ?)');
    createdProductIds.forEach(pid => {
      const tagCount = Math.floor(Math.random() * 3) + 1;
      const shuffled = [...tagIds].sort(() => Math.random() - 0.5);
      for (let i = 0; i < tagCount; i++) {
        ptStmt.run(pid, shuffled[i]);
      }
    });
    ptStmt.finalize();
  }

  if (hasOrders && hasOrderItems && hasUsers && hasProducts) {
    console.log(`  生成 ${orderCount} 个订单...`);
    const orderStmt = database.db.prepare('INSERT INTO orders (user_id, total, status, order_date) VALUES (?, ?, ?, ?)');
    const orderItemStmt = database.db.prepare('INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)');

    for (let i = 1; i <= orderCount; i++) {
      const userId = Math.floor(Math.random() * userCount) + 1;
      const orderDate = randomDate(new Date(2024, 0, 1), new Date(2024, 11, 31));
      const itemCount = Math.floor(Math.random() * 5) + 1;
      let total = 0;

      const orderId = i;
      for (let j = 0; j < itemCount; j++) {
        const productId = Math.floor(Math.random() * productCount) + 1;
        const quantity = Math.floor(Math.random() * 5) + 1;
        const price = Math.floor(Math.random() * 5000) + 50;
        total += price * quantity;
        orderItemStmt.run(orderId, productId, quantity, price);
      }

      orderStmt.run(userId, total, statuses[Math.floor(Math.random() * statuses.length)], orderDate);
    }

    orderStmt.finalize();
    orderItemStmt.finalize();
  }

  await database.loadTableMetadata();

  console.log('');
  console.log('示例数据生成完成！');
  if (hasUsers) console.log(`  - users (${userCount}行): 用户表`);
  if (hasProducts) console.log(`  - products (${productCount}行): 商品表`);
  if (hasOrders) console.log(`  - orders (${orderCount}行): 订单表 (外键: user_id -> users.id)`);
  if (hasOrderItems) console.log(`  - order_items (约${orderCount * 3}行): 订单项表`);
  if (hasTags) console.log(`  - tags (${tagNames.length}行): 标签表`);
}

module.exports = { seed };
