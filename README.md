# Manankuragayalu (`manaveg`)

A local fresh-vegetable and everyday essentials ordering platform built on **Cloudflare Workers**, **Cloudflare D1** (SQLite), and **Cloudflare R2** — with a customer storefront, a store admin portal, and zero runtime npm dependencies.

## Architecture & Project Layout

The repository contains three Cloudflare Workers and a local Node.js development harness:

```text
.
├── apps/
│   ├── backend/                # API Worker (manankuragayalu-backend)
│   │   ├── migrations/         # D1 SQLite migrations (0001–0010)
│   │   ├── src/
│   │   │   ├── index.mjs       # Worker entry & routing
│   │   │   ├── auth.mjs        # Email OTP login/signup + rate limiting
│   │   │   ├── sessions.mjs    # Cookie-based session management
│   │   │   ├── delivery.mjs    # 20 km Haversine delivery eligibility
│   │   │   └── shop.mjs        # Catalog, profile, coupons, checkout & admin APIs
│   │   └── wrangler.jsonc
│   ├── customer/               # Customer storefront Worker (shop)
│   │   ├── public/             # Vanilla HTML/CSS/ESM SPA
│   │   ├── worker.mjs
│   │   └── wrangler.jsonc
│   └── admin/                  # Store admin Worker (admin)
│       ├── public/             # Vanilla HTML/CSS/ESM SPA
│       ├── worker.mjs
│       └── wrangler.jsonc
├── packages/
│   └── frontend/worker.mjs     # Shared Worker proxying /api/* to BACKEND & serving ASSETS
├── scripts/
│   ├── dev.mjs                 # Local multi-app HTTP dev server
│   ├── local-db.mjs            # In-memory node:sqlite D1 shim with seeded demo data
│   ├── demo-produce.mjs        # Sample vegetable catalog for local preview
│   └── demo-photos/            # Sample product images
└── test/                       # Node.js test suite (node --test)
```

Both `apps/customer` and `apps/admin` serve static assets from their `public/` directories and forward `/api/*` traffic to `apps/backend` via Cloudflare Service Bindings (`BACKEND`).

## Key Features

### Customer Storefront (`apps/customer`)
- **Catalog & Search:** Browse products by category (`Vegetables`, `Eggs`, `Groceries`), filter by search query, view tags (`Regular`, `Today's special`, `Leafy vegetables`, `Seasonal`, `Fruit`), and choose weight packs (`250 g`, `500 g`, `1 kg`) or fixed packs.
- **Delivery Area Check:** Validates customer coordinates against the store's dispatch point using a **< 20 km** Haversine radius.
- **Cart, Offers & Checkout:**
  - Live free-delivery progress bar based on the configurable subtotal threshold.
  - Coupon code quoting and redemption (`Everyone`, `Selected customers`, or `First-time users`), limited to one use per customer and capped by total coupon budget.
  - Idempotent order submission (`Idempotency-Key`), delivery slot selection, optional WhatsApp update consent, and payment on delivery.
- **Accounts & Profiles:** Passwordless 6-digit email OTP sign-up/sign-in with unique usernames (`3–24` alphanumeric/underscore characters), persistent `__Host-session` cookies, saved delivery details, and paginated order history.

### Store Admin Portal (`apps/admin`)
- **Daily Dashboard:** Real-time IST (`UTC+5:30`) counts for today's total, pending, accepted, and delivered bookings, plus today's delivered revenue.
- **Booking Management:** Accept (`Placed` → `Confirmed`), Reject (`Placed` → `Rejected`, restoring slot capacity and stock), or mark Accepted bookings as `Delivered`.
- **Catalog Management:** Publish and edit weight-priced (`250 g` / `500 g` / `1 kg`) or fixed-pack products, upload JPEG/PNG/WebP photos (up to 2 MB stored in R2), assign tags, apply discounts, and prevent stale stock overwrites via optimistic concurrency checks.
- **Offers Management:** Update the free-delivery subtotal threshold and publish global, first-order, or customer-targeted budget-capped coupons with customer search by username or email.

### Database & Integrity Notes
- All prices, fees, discounts, and thresholds are stored in integer **paise** (₹1 = `100`).
- SQLite triggers across `apps/backend/migrations/0001_store.sql`–`0010_free_delivery.sql` atomically enforce stock deduction, delivery slot reservation, free-delivery fee validation, coupon budget/first-order checks, order event logging, and automatic stock/slot restoration on rejection or cancellation.

## Prerequisites

- **Node.js 22.9+** (required for built-in `node:sqlite` and `--env-file-if-exists`)
- **npm** (used to install `wrangler` for Cloudflare deployment)

## Local Development

Install dev dependencies (optional for running `npm run dev` / `npm test`, required for `wrangler`):

```bash
npm install
```

Start the local development servers:

```bash
npm run dev
```

This runs an in-memory SQLite database seeded with all migrations, 21 demo vegetables (with local photos), sample groceries/eggs, a demo delivery window, and demo accounts:

| App | Local URL | Demo Account |
| --- | --- | --- |
| Customer storefront | `http://localhost:8787` | `shopper@example.test` (or sign up with any email) |
| Store admin portal | `http://127.0.0.1:8788` | `staff@example.test` |

> Customer and admin intentionally run on separate hostnames (`localhost` vs `127.0.0.1`) so session cookies do not collide between the two apps.

### Admin Sign-in

1. Run `npm run dev` and open `http://127.0.0.1:8788`.
2. Sign in as `staff@example.test` using the six-digit code printed in the terminal.
3. To test with a real inbox, set `LOCAL_ADMIN_EMAIL` to that address and configure `BREVO_API_KEY` and `BREVO_SENDER` (e.g., in `.env`) before restarting the dev server.

Deployed admin sign-in uses an account already provisioned with the `admin` role in D1 and the backend's Brevo configuration.

### Environment Variables

#### Local development (`.env` or shell)
| Variable | Default | Description |
| --- | --- | --- |
| `CUSTOMER_PORT` | `8787` | Port for the customer storefront dev server |
| `ADMIN_PORT` | `8788` | Port for the admin portal dev server |
| `LOCAL_ADMIN_EMAIL` | `staff@example.test` | Email provisioned with the `admin` role in local dev |
| `BREVO_API_KEY` | *(unset — terminal preview)* | Brevo SMTP API key; if unset, OTP codes print to the terminal |
| `BREVO_SENDER` | `manaveg083@gmail.com` | Verified Brevo sender email address |

#### Deployed backend Worker (`apps/backend`)
- **Vars** (`apps/backend/wrangler.jsonc`): `BREVO_SENDER`, `DISPATCH_MAP_URL`
- **Secrets** (`wrangler secret put`): `BREVO_API_KEY`, `OTP_SECRET`
- **Bindings**: D1 `DB` (`manankuragayalu`), R2 `PHOTOS` (`manankuragayalu-photos`)

## Running Tests

Run the test suite with Node's built-in test runner:

```bash
npm test
```

Tests in `test/` cover:
- `test/checkout.test.mjs` — catalog publishing, weight-based pack creation, last-unit checkout concurrency, customer profile isolation, email signup/login/logout, admin OTP access control, and targeted coupon budget reservation/release.
- `test/delivery.test.mjs` — 20 km delivery radius eligibility boundaries.
- `test/order-access.test.mjs` — per-customer session isolation for order listing and order lookups.

## API Overview

| Group | Method & Path | Description |
| --- | --- | --- |
| **Health** | `GET /api/health` | Health check |
| **Auth** | `POST /api/auth/otp/request` | Request a 6-digit email OTP (`login`, `signup`, or `admin`) |
| | `POST /api/auth/otp/verify` | Verify OTP and issue `__Host-session` cookie |
| | `POST /api/auth/logout` | Revoke active session and clear cookie |
| **Public** | `GET /api/catalog` | Active products, categories, open delivery slots, fee & free-delivery threshold |
| | `GET /api/photos/:id` | Serve product image from R2 |
| | `POST /api/delivery/check` | Check `{ lat, lon }` distance and `< 20 km` eligibility |
| **Customer** | `GET /api/profile`, `POST /api/profile` | Read or update signed-in customer profile & saved address |
| | `POST /api/coupons/quote` | Validate coupon code against current cart and account |
| | `POST /api/orders` | Place an idempotent order (`Idempotency-Key` header required) |
| | `GET /api/orders`, `GET /api/orders/:id` | Paginated order list or single order details for the signed-in customer |
| **Admin** | `GET /api/admin/orders` | Recent orders (`?today=1` returns today's IST counts, active bookings & delivered revenue) |
| | `POST /api/admin/orders/:id/decision` | Transition order (`accept`, `reject`, or `deliver`) |
| | `GET /api/admin/catalog`, `POST /api/admin/catalog`, `PUT /api/admin/catalog/:id` | List, publish, and edit products (multipart with optional photo) |
| | `GET /api/admin/delivery-offer`, `PUT /api/admin/delivery-offer` | Read or update free-delivery subtotal threshold |
| | `GET /api/admin/customers?q=...` | Search customers by username or email |
| | `GET /api/admin/coupons`, `POST /api/admin/coupons` | List coupons with usage totals or publish a new coupon |

## Deployment (Cloudflare)

1. Create the D1 database (`manankuragayalu`) and R2 bucket (`manankuragayalu-photos`), then replace `REPLACE_WITH_D1_ID` in `apps/backend/wrangler.jsonc` with your D1 `database_id`.
2. Apply all SQL migrations in `apps/backend/migrations/` (`0001_store.sql` through `0010_free_delivery.sql`) to your D1 database.
3. Configure dispatch coordinates (`lat`, `lon`, `fee`) in the `settings` table (`id = 1`), seed initial categories/slots, and insert at least one `admin` user in the `users` table.
4. Set backend secrets via Wrangler (`OTP_SECRET` and `BREVO_API_KEY`).
5. Deploy the backend Worker first, followed by the customer and admin Workers:
   ```bash
   npx wrangler deploy --config apps/backend/wrangler.jsonc
   npx wrangler deploy --config apps/customer/wrangler.jsonc
   npx wrangler deploy --config apps/admin/wrangler.jsonc
   ```
