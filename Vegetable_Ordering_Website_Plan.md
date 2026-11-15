# Vegetable Ordering Website — Product and Implementation Plan

## 1. First release

Build a mobile-friendly customer storefront and a protected admin dashboard backed by one API and one PostgreSQL database. Customers book vegetables online. Staff manage the catalog, prepare orders, and update fulfillment. When checkout succeeds, the website immediately shows the order number and queues a WhatsApp confirmation for customers who opted in.

**Working assumptions to confirm before launch:** One store and inventory pool, prices in INR, delivery within selected PIN codes, fixed pack sizes (250 g, 500 g, 1 kg, bunch or piece), and payment on delivery. Use scheduled delivery windows in Asia/Kolkata, with the operator setting capacity and cutoff times. Offer online payments, pickup, multi-store inventory, and live rider tracking as separate follow-up decisions.

| Decision | Input needed from the store owner |
|---|---|
| Delivery coverage | Launch PIN codes, delivery fees, minimum order and free-delivery threshold if offered |
| Hours and capacity | Daily slots, booking cutoff, holidays, and max bookings per slot |
| Initial catalog | Product names, categories, photos, available pack sizes, prices and opening stock |
| Packing and exceptions | Cancellation cutoff, policy for damaged produce, substitution rules and support number |
| Payments | Cash on delivery and whether staff may collect UPI at delivery |
| Messaging | Business sender number, expected message language, and support contact for replies |
| Staffing | Owner and staff accounts, who can change prices, who dispatches and who confirms delivery |

## 2. Customer website

| Screen | What the customer can do | Important behavior |
|---|---|---|
| Home / catalog | Search, browse categories and pick a pack size | Show photo, pack size, price, available or sold-out label and PIN code checker |
| Product page | View details and add one or more packs | Display the price for the selected pack and the quantity being purchased |
| Cart | Change quantities, remove items, review estimated total | Browsing and guest cart work without login. Keep the cart through sign-in and revalidate its contents |
| Login | Enter mobile number and verify an SMS OTP | Verify the phone before checkout, rate-limit OTP attempts and resend requests, and preserve cart on reload |
| Checkout | Choose address, delivery slot and payment on delivery, then review total | Validate PIN code, address, current prices, stock, slot capacity and delivery fee. Allow WhatsApp updates using the verified login number |
| Booking success | View order number, items, total, delivery window and payment method | Show confirmation as soon as the booking is saved, even when WhatsApp is pending or unavailable |
| My Orders | See current and past bookings, open details and follow the status timeline | Show cancellation when policy permits and provide a support link for exceptions |

**Checkout contact fields.** Capture recipient name, phone, house or flat, street, locality, city, PIN code and optional landmark or delivery note. Default WhatsApp updates to the verified account number. If alternate WhatsApp numbers are supported later, verify ownership before sending. Use a separate, unchecked option such as “Send order updates to my number on WhatsApp.” Record the number, exact consent text version, timestamp and source. A customer can still book without selecting it. Keep a separate **Contact store on WhatsApp** link for the shop support number.

**Checkout example.** Two 500 g tomato packs at ₹25 plus one 1 kg onion pack at ₹40 gives a ₹90 subtotal. With ₹20 delivery, the customer reviews ₹110 payable on delivery. When they place the order, the server reserves two tomato packs, one onion pack and one place in the selected slot. The confirmation page immediately displays the order number and ₹110 total.

## 3. Admin dashboard

| Screen | Actions and rules |
|---|---|
| Dashboard | Show today's bookings by status, next delivery slots, low stock and failed WhatsApp notices. Link counts to filtered views |
| Categories | Create, rename, reorder and hide categories such as Leafy Greens, Roots, and Everyday Vegetables. Warn when hiding a category with published products |
| Products | Create drafts, upload photo and alt text, choose category, enter name and description, create pack variants, publish or archive. An archived variant stays visible on earlier order records |
| Pack variants | Assign a unique SKU, pack size or unit, selling price and low-stock threshold. Preview price and unit shown in the storefront. Treat a pack-size change as a new SKU |
| Inventory | Record opening stock, restock, spoilage and corrections as signed stock movements with a reason. Show physical stock, reserved stock and available stock for every SKU |
| Orders list | Filter by delivery date, slot, status and order number. Highlight new orders and overdue preparation. Show the assigned slot and payment status |
| Order detail | View item and price snapshots, address, contact, notes, stock exceptions and event history. Use explicit actions to confirm, start packing, dispatch, deliver or cancel |
| Delivery settings | Configure PIN codes, fees, minimum order, slots, capacities, cutoff times and holiday closures. Existing bookings retain the agreed slot and fee |
| Notifications | Show queued, accepted, delivered, failed or skipped, with timestamps and error summaries. Authorized staff can retry eligible failed sends |
| Staff and audit | Invite staff, assign permissions and disable access. Record who changed prices, quantities, settings, order status and notification retries |

**Roles.** The owner manages staff, settings and pricing. Catalog staff manage products and inventory. Fulfillment staff work orders and record payment collection. Grant access to customer addresses and phone numbers only to staff handling orders or support. Use named admin accounts with MFA and enforce permissions in the API.

**Daily operating routine.** Before opening, update prices and count sellable packs, check today's capacity and publish available products. During the day, work through orders by slot, verify packs against the list, then dispatch. At handover, record delivery and collection. At the end of the day, reconcile cash or UPI collections, log spoilage and review unsuccessful deliveries or failed notifications.

## 4. Order lifecycle and stock rules

| Status | Set by | Effect |
|---|---|---|
| Placed | System after successful checkout | Save the order and reserve stock and slot capacity. Queue the opted-in order-placed WhatsApp message |
| Confirmed | Fulfillment staff | Accept the booking for preparation. Customer tracking updates immediately |
| Packing | Fulfillment staff | Prepare reserved items and flag shortages for support |
| Out for delivery | Fulfillment staff | Deduct the dispatched packs from physical and reserved stock together. Store dispatch time |
| Delivered | Fulfillment staff | Store delivery time and collection outcome. Optionally queue a delivery-completed message if this event is enabled |
| Cancelled | Customer from Placed before cutoff, or authorized staff before dispatch with reason | Release stock and slot reservations once. Keep the cancellation reason and timestamp |
| Delivery failed | Fulfillment staff after dispatch | Record reason and hand over to support. Returned stock is counted back only after inspection via a stock adjustment |

Normal sequence: Placed → Confirmed → Packing → Out for delivery → Delivered. Dispatch may instead end in Delivery failed. Use a controlled support process for a failed delivery. A rebooked delivery gets a new order reference and its own stock and slot validation. Payment collection is separate, with Pending and Collected states and fields for cash or approved UPI, amount, time and staff actor. Record any delivered-but-unpaid exception for follow-up.

**Inventory example.** If physical stock is 20 packs and 5 are reserved, 15 packs are available. Dispatching 2 of the reserved packs leaves 18 physical and 3 reserved, so 15 remain available. Adjustments that would put physical stock below existing reservations require a shortage resolution. For launch, staff contact the customer and cancel or rebook if an agreed order cannot be filled. Keep the original order history and avoid automatic substitutions.

**Order history.** Save product name, SKU, unit, quantity, unit price, line total, delivery fee, delivery window and address as immutable order snapshots. Catalog updates apply to new checkouts. Log each status change with actor, timestamp and reason where required. Reject invalid or stale transitions, including repeated cancellation.

## 5. Technical architecture

Use a Next.js/TypeScript app for the storefront and admin routes, a Node.js API (either Next.js route handlers or a separate service if the team already uses one), PostgreSQL, object storage for catalog photos and a small background worker for WhatsApp. A PostgreSQL-backed queue is sufficient for the first release. Keep staging and production separate with their own databases, secrets, storage and messaging configuration.

| Data | Main fields and integrity rules |
|---|---|
| users, admin_roles, addresses | Unique normalized verified phone per customer, named staff roles, addresses tied to owners |
| categories, products, product_variants | Category and product publication state, unique SKU, pack size, price in integer paise, photo reference |
| inventory, inventory_movements | SKU, on-hand and reserved counts, movement reason, quantity, actor and order reference. Prevent negative available stock |
| delivery_zones, delivery_slots | PIN codes, date, start/end, cutoff, fee settings, capacity and current bookings |
| carts, cart_items | Customer cart and per-SKU integer quantity. A guest cart can be stored locally until sign-in |
| orders, order_items | Unique order reference, customer, status, collection status, snapshots, totals and timestamps |
| order_status_events, audit_events | Append-only actor, action, timestamps and relevant changes. Restrict access and avoid logging sensitive content |
| notification_preferences, notification_outbox | Recipient and consent record, template, event key, retry state, provider message ID and delivery status |
| checkout_requests | Unique customer and idempotency key, request fingerprint and resulting order reference |

### Critical checkout transaction

1. Authenticate the customer, validate the request and bind the submitted idempotency key to the request fingerprint. A repeat with the same key and payload returns the original order. A changed payload needs a new key.
2. Open a database transaction. Lock the requested SKU and slot rows in a consistent order. Recheck active products, stock, delivery address and PIN code, slot cutoff and capacity, and the current server-calculated total. If price, fee or availability changed since review, return the updated quote or conflicts for the customer to review.
3. Insert the order, its snapshots and initial status event. Update stock reservations and slot capacity. Insert a notification outbox row when eligible and link the idempotency key to the order. Commit all changes together.
4. Return the order reference, then clear the cart on confirmed success and show the success page. If the browser times out after commit, retry with the same key and retrieve the same order. The worker submits WhatsApp after commit in its own process.

| API | Purpose |
|---|---|
| POST /auth/otp/request, POST /auth/otp/verify | Start and verify phone login |
| GET /categories, GET /products | Browse published products and variants with search, filters and pagination |
| GET /delivery/slots?pinCode=... | List bookable delivery windows for a PIN code |
| GET /cart, PUT /cart/items/{sku}, DELETE /cart/items/{sku} | Read and update the signed-in cart using absolute quantities |
| POST /checkout/quote, POST /orders | Calculate current totals and create a booking using an Idempotency-Key header |
| GET /orders, GET /orders/{id}, POST /orders/{id}/cancel | Customer order history, status and eligible cancellation. Enforce ownership |
| POST /admin/categories, PATCH /admin/categories/{id} | Maintain categories |
| POST /admin/products, PATCH /admin/products/{id}, POST /admin/products/{id}/variants | Manage catalog and sellable packs |
| POST /admin/inventory/{sku}/adjustments | Record a stock movement with reason |
| GET /admin/orders, PATCH /admin/orders/{id}/status | Browse bookings and advance valid transitions with expected current status or version |
| POST /admin/orders/{id}/payment-collection | Record collection amount, method and actor |
| GET /admin/notifications, POST /admin/notifications/{id}/retry | Monitor and retry eligible message failures |
| GET and POST /webhooks/whatsapp | Handle provider verification and verified delivery-status events |

### Access and reliability

Use secure sessions, input validation and rate limits for login and checkout. Validate file type and size when uploading photos. Keep credentials server-side. Mask phone numbers in general logs, restrict customer data access, and configure retention for order contacts and operational logs. Monitor checkout errors, failed WhatsApp sends, low stock and missed delivery windows. Schedule database backups and run a restore rehearsal before launch.

## 6. WhatsApp order notifications

The first message is **Order placed** and is queued after a successful checkout. **Order delivered** is a separate optional message triggered when staff mark the order Delivered. SMS in the first release is for login OTP. An SMS fallback for order confirmations can be added if the store wants it and has configured the applicable messaging setup.

1. Connect a WhatsApp Business Account and sender number to Meta's WhatsApp Business Platform or an official provider. Set up API credentials and webhook verification in staging.
2. Submit a utility template for approval, for example `vegetable_order_placed`. Keep the template transactional and use variables for customer name, order number, total and promised slot. Add a tracking link that requires customer login if the product supports it.
3. Save the customer's consent during checkout and check eligibility again before sending. Use a unique order/event/channel key to suppress duplicate jobs. Keep the event transactional even if WhatsApp is currently unavailable.
4. A background worker claims the job, submits the template and records the provider message ID. Process verified webhook events idempotently and guard against out-of-order updates. Provider acceptance and delivery are separate states.
5. Retry clearly transient failures with bounded backoff. If a request times out after submission and the acceptance outcome is uncertain, reconcile before resending when possible and flag unresolved attempts for review. Show failures in the dashboard. The customer's website receipt remains available.

**Example message body:**  
Hi {{1}}, your vegetable order {{2}} has been placed. Total payable on delivery: {{3}}. Delivery window: {{4}}. Open My Orders on our website to check the latest status.

Official references: [WhatsApp Business Platform overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview) · [Meta message templates](https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account/message_templates/) · [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy) · [Meta webhook setup](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/)

## 7. Build sequence

| Step | Build | Ready when |
|---|---|---|
| 1. Confirm business inputs | Fix the delivery area, delivery fees, hours, booking cutoff, cancellation rules and initial products. Sketch customer checkout and admin order detail | The owner can explain how one booking is packed, delivered and collected |
| 2. Set up foundations | Create app structure, database migrations, environments, customer OTP and admin MFA/permissions. Seed sample data | Customer and staff sign in and permissions are enforced server-side |
| 3. Deliver catalog and inventory | Build admin category/product forms, image upload, variant pricing, inventory ledger and storefront browsing | Staff publish a vegetable and a customer can see and select its pack |
| 4. Deliver checkout | Build cart, address validation, slots, quote, idempotent order creation and success page | A real staging checkout produces an order and reserves stock and capacity |
| 5. Deliver admin fulfillment | Build order queue, detail, valid transitions, cancellation, dispatch and collection | Staff can complete an order and the customer sees each status update |
| 6. Deliver WhatsApp | Approve the template, wire outbox worker and webhooks, test consent and failure paths | An opted-in test customer receives one correct confirmation for a successful booking |
| 7. Pilot and launch | Load opening stock, confirm the support number, rehearse a day's orders and launch in a limited delivery area | Staff can reconcile orders, collections and inventory with production monitoring active |

## 8. Acceptance checklist

- Publish a tomato pack in admin, search for it as a customer, place an order on mobile and see it appear in the admin queue.
- Price changes before checkout trigger a refreshed quote. Price changes after the order leave the saved total intact.
- Two customers compete for the final pack or last slot. Exactly one order succeeds.
- Double-clicking Place order, refreshing after a timeout and repeating the request with the same key produce one booking and one confirmation job.
- Unsupported PIN codes, full slots, expired slots and unavailable variants show clear recovery options.
- A customer cannot access someone else's order or an admin endpoint. A fulfillment user cannot alter prices without the catalog permission.
- Cancel a qualifying order and confirm stock and slot reservations are released exactly once. Dispatch a different order and confirm physical stock is deducted once.
- Complete a delivery, record the collection and see the final timeline as the customer.
- Successful opt-in sends one correctly addressed WhatsApp message. An opt-out still receives the website receipt. Provider failure leaves the booking valid and visible.
- Confirm staff can restore a backup, identify failed jobs and reconcile stock and collection totals after a pilot day.

