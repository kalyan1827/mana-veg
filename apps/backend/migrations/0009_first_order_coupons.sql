ALTER TABLE coupons ADD COLUMN first_time INTEGER NOT NULL DEFAULT 0 CHECK(first_time IN (0,1));
CREATE TRIGGER reserve_first_order_coupon BEFORE INSERT ON orders
WHEN EXISTS (SELECT 1 FROM coupons WHERE code=NEW.coupon_code AND first_time=1)
  AND EXISTS (SELECT 1 FROM orders WHERE email=NEW.email AND status NOT IN ('Rejected','Cancelled'))
BEGIN
  SELECT RAISE(ABORT,'coupon_unavailable');
END;
