UPDATE slots SET label = 'Next day delivery';
INSERT OR IGNORE INTO slots (id, label, cutoff, capacity, booked)
VALUES ('next-day', 'Next day delivery', 253402300799000, 100000, 0);

