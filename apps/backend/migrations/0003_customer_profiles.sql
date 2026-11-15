CREATE TABLE customer_profiles (
  email TEXT PRIMARY KEY REFERENCES users(email),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL,
  lon REAL
);
