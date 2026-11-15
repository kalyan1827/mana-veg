ALTER TABLE orders ADD COLUMN delivered_at INTEGER;
CREATE INDEX orders_delivered_at ON orders(delivered_at);

CREATE TRIGGER record_order_delivery AFTER UPDATE OF status ON orders
WHEN OLD.status='Confirmed' AND NEW.status='Delivered' BEGIN
  INSERT INTO order_events(order_id,status,actor,at)
    VALUES(NEW.id,NEW.status,NEW.decision_actor,NEW.delivered_at);
END;
