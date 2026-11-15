CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK(id = 1), label TEXT NOT NULL,
  lat REAL, lon REAL, fee INTEGER NOT NULL CHECK(fee >= 0)
);
INSERT INTO settings VALUES (1,'Gandhinagar, Bowenpally',NULL,NULL,2000);
CREATE TABLE users (email TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('customer','admin')), mfa_secret TEXT, last_mfa_step INTEGER);
CREATE TABLE otp (email TEXT PRIMARY KEY, digest TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL);
CREATE TABLE sessions (token TEXT PRIMARY KEY, email TEXT NOT NULL REFERENCES users(email), expires INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires);
CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE);
CREATE TABLE products (
  id TEXT PRIMARY KEY, category TEXT NOT NULL REFERENCES categories(id), name TEXT NOT NULL,
  unit TEXT NOT NULL, price INTEGER NOT NULL CHECK(price > 0), stock INTEGER NOT NULL CHECK(stock >= 0),
  active INTEGER NOT NULL CHECK(active IN (0,1)), photo TEXT
);
CREATE INDEX products_browse ON products(active,category);
CREATE TABLE slots (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, cutoff INTEGER NOT NULL,
  capacity INTEGER NOT NULL CHECK(capacity > 0), booked INTEGER NOT NULL DEFAULT 0 CHECK(booked BETWEEN 0 AND capacity)
);
CREATE INDEX slots_cutoff ON slots(cutoff);
CREATE TABLE orders (
  id TEXT PRIMARY KEY, email TEXT NOT NULL REFERENCES users(email), request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
  address TEXT NOT NULL, phone TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, distance REAL NOT NULL,
  origin_lat REAL NOT NULL, origin_lon REAL NOT NULL, slot TEXT NOT NULL REFERENCES slots(id),
  slot_label TEXT NOT NULL, items TEXT NOT NULL, fee INTEGER NOT NULL, total INTEGER NOT NULL,
  consent INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'Placed', collected INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL, UNIQUE(email,request_key)
);
CREATE INDEX orders_customer ON orders(email,created DESC);
CREATE INDEX orders_recent ON orders(created DESC);
CREATE TABLE order_events (id INTEGER PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), status TEXT NOT NULL, actor TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE outbox (order_id TEXT PRIMARY KEY REFERENCES orders(id), state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, provider_id TEXT, detail TEXT);
CREATE INDEX outbox_pending ON outbox(state,next_at);
CREATE TABLE rate_limits (bucket TEXT PRIMARY KEY, hits INTEGER NOT NULL, expires INTEGER NOT NULL);

CREATE TRIGGER reserve_order BEFORE INSERT ON orders BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM settings WHERE id=1 AND lat=NEW.origin_lat AND lon=NEW.origin_lon AND fee=NEW.fee
  ) THEN RAISE(ABORT,'settings_changed') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM slots WHERE id=NEW.slot AND cutoff > unixepoch()*1000 AND booked < capacity AND label=NEW.slot_label
  ) THEN RAISE(ABORT,'slot_unavailable') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.items) item LEFT JOIN products p ON p.id=item.value->>'id'
    WHERE p.id IS NULL OR p.active<>1 OR p.stock<(item.value->>'quantity')
       OR p.price<>(item.value->>'price') OR p.name<>(item.value->>'name') OR p.unit<>(item.value->>'unit')
  ) THEN RAISE(ABORT,'catalog_changed') END;
  UPDATE slots SET booked=booked+1 WHERE id=NEW.slot;
  UPDATE products SET stock=stock-(
    SELECT item.value->>'quantity' FROM json_each(NEW.items) item WHERE item.value->>'id'=products.id
  ) WHERE id IN (SELECT value->>'id' FROM json_each(NEW.items));
END;

CREATE TRIGGER log_order AFTER INSERT ON orders BEGIN
  INSERT INTO order_events(order_id,status,actor,at) VALUES(NEW.id,NEW.status,NEW.email,NEW.created);
  INSERT INTO outbox(order_id,next_at) SELECT NEW.id,NEW.created WHERE NEW.consent=1;
END;

CREATE TRIGGER cancel_order AFTER UPDATE OF status ON orders WHEN NEW.status='Cancelled' AND OLD.status<>'Cancelled' BEGIN
  UPDATE slots SET booked=booked-1 WHERE id=NEW.slot;
  UPDATE products SET stock=stock+(
    SELECT item.value->>'quantity' FROM json_each(NEW.items) item WHERE item.value->>'id'=products.id
  ) WHERE id IN (SELECT value->>'id' FROM json_each(NEW.items));
END;
