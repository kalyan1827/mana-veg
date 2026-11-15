ALTER TABLE orders ADD COLUMN decision_actor TEXT;

CREATE TRIGGER record_booking_decision AFTER UPDATE OF status ON orders
WHEN OLD.status='Placed' AND NEW.status IN ('Confirmed','Rejected') BEGIN
  INSERT INTO order_events(order_id,status,actor,at)
    VALUES(NEW.id,NEW.status,NEW.decision_actor,unixepoch()*1000);
  UPDATE slots SET booked=booked-1 WHERE id=NEW.slot AND NEW.status='Rejected';
  UPDATE products SET stock=stock+(
    SELECT item.value->>'quantity' FROM json_each(NEW.items) item WHERE item.value->>'id'=products.id
  ) WHERE NEW.status='Rejected' AND id IN (SELECT value->>'id' FROM json_each(NEW.items));
END;
