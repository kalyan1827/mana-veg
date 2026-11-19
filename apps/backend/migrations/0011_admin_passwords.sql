ALTER TABLE users ADD COLUMN password_hash TEXT;

INSERT INTO users(email, role) VALUES ('manaveg083@gmail.com', 'admin')
ON CONFLICT(email) DO UPDATE SET role='admin';

INSERT INTO users(email, role) VALUES ('ranjithbellam91901@gmail.com', 'admin')
ON CONFLICT(email) DO UPDATE SET role='admin';
