ALTER TABLE settings ADD COLUMN free_delivery_threshold INTEGER NOT NULL DEFAULT 50000 CHECK(free_delivery_threshold>=0);

DROP TRIGGER reserve_order;

CREATE TRIGGER reserve_order BEFORE INSERT ON orders BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM settings WHERE id=1 AND lat=NEW.origin_lat AND lon=NEW.origin_lon AND NEW.fee=CASE WHEN NEW.total-NEW.fee>free_delivery_threshold THEN 0 ELSE fee END
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
