UPDATE products
SET price=original_price, original_price=NULL
WHERE pack_group IS NOT NULL
  AND unit IN ('250 g','500 g')
  AND original_price IS NOT NULL;
