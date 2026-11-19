import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { vegetables } from './demo-produce.mjs';
export function localDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../apps/backend/migrations/0001_store.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../apps/backend/migrations/0002_booking_decisions.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../apps/backend/migrations/0003_customer_profiles.sql',import.meta.url),'utf8'));
  sqlite.exec("INSERT INTO users(email,role) VALUES ('shopper@example.test','customer'),('staff@example.test','admin'); UPDATE settings SET lat=17.47,lon=78.48; INSERT INTO categories VALUES ('vegetables','Vegetables'); INSERT INTO slots VALUES ('local','Demo delivery window',unixepoch()*1000+86400000,10,0); INSERT INTO products VALUES ('tomato','vegetables','Tomato','500 g',2500,3,1,NULL);");
  sqlite.exec("INSERT INTO categories VALUES ('eggs','Eggs'),('groceries','Groceries'); INSERT INTO products VALUES ('eggs-six','eggs','Farm eggs','6 eggs',6500,12,1,NULL),('rice','groceries','Rice','1 kg',7500,12,1,NULL),('onions','vegetables','Onions','500 g',3000,12,1,NULL);");
  sqlite.exec(readFileSync(new URL('../apps/backend/migrations/0004_weight_pricing.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../apps/backend/migrations/0005_catalog_promotions.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../apps/backend/migrations/0006_order_delivery.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../apps/backend/migrations/0007_kilo_only_offers.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../apps/backend/migrations/0008_coupons.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../apps/backend/migrations/0009_first_order_coupons.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../apps/backend/migrations/0010_free_delivery.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../apps/backend/migrations/0011_admin_passwords.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../apps/backend/migrations/0012_next_day_delivery.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../apps/backend/migrations/0013_product_photos.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../apps/backend/migrations/0014_delivery_fee_49.sql',import.meta.url),'utf8'));
  sqlite.exec("DELETE FROM products WHERE id IN ('tomato','onions')");
  const insertPack = sqlite.prepare(`INSERT INTO products
    (id,category,name,unit,price,stock,active,photo,pack_group,kilo_price)
    VALUES (?,'vegetables',?,?,?,?,1,?,?,?)`);
  for (const [key,name,rupees] of vegetables) {
    insertPack.run(key+'-250g',name,'250 g',rupees*25,24,key,key,rupees*100);
    insertPack.run(key+'-500g',name,'500 g',rupees*50,18,key,key,rupees*100);
    insertPack.run(key+'-1kg',name,'1 kg',rupees*100,12,key,key,rupees*100);
  }
  return { prepare(sql) {
    return { bind(...args) {
      const statement=sqlite.prepare(sql);
      return { first:async()=>statement.get(...args) ?? null, all:async()=>({results:statement.all(...args)}), run:async()=>statement.run(...args) };
    }, all() { return this.bind().all(); }, first() { return this.bind().first(); }, run() { return this.bind().run(); } };
  } };
}
