ALTER TABLE users ADD COLUMN username TEXT COLLATE NOCASE;
CREATE UNIQUE INDEX users_username ON users(username);

CREATE TABLE coupons (
  code TEXT PRIMARY KEY,
  discount INTEGER NOT NULL CHECK(discount>0),
  budget INTEGER NOT NULL CHECK(budget>=discount),
  customers TEXT,
  created INTEGER NOT NULL
);
ALTER TABLE orders ADD COLUMN coupon_code TEXT REFERENCES coupons(code);
ALTER TABLE orders ADD COLUMN coupon_discount INTEGER NOT NULL DEFAULT 0;
CREATE INDEX orders_coupon ON orders(coupon_code,email);

CREATE TRIGGER reserve_coupon BEFORE INSERT ON orders
WHEN NEW.coupon_code IS NOT NULL BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM coupons c WHERE c.code=NEW.coupon_code AND c.discount=NEW.coupon_discount
      AND NEW.coupon_discount<=NEW.total+NEW.coupon_discount-NEW.fee
      AND (c.customers IS NULL OR EXISTS (SELECT 1 FROM json_each(c.customers) WHERE value=NEW.email))
      AND c.budget>=c.discount+COALESCE((SELECT SUM(o.coupon_discount) FROM orders o
        WHERE o.coupon_code=c.code AND o.status NOT IN ('Rejected','Cancelled')),0)
      AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.coupon_code=c.code AND o.email=NEW.email
        AND o.status NOT IN ('Rejected','Cancelled'))
  ) THEN RAISE(ABORT,'coupon_unavailable') END;
END;
