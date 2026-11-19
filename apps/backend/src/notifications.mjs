const SHOP_NAME = 'Manankuragayalu';
const DEFAULT_ADMIN_WHATSAPP = '919398750721';

function formatRupees(paise) {
  return '₹' + (Number(paise || 0) / 100).toFixed(2);
}

function normalizeWhatsApp(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 10 ? '91' + digits : digits;
}

function whatsappInvoiceLink(phone, order) {
  const target = normalizeWhatsApp(phone);
  if (!target) return '';
  const items = Array.isArray(order.items) ? order.items : JSON.parse(order.items || '[]');
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = Number(order.coupon_discount || 0);
  const fee = Number(order.fee || 0);
  const shortId = String(order.id).slice(0, 8).toUpperCase();
  const lines = [
    `*${SHOP_NAME} — Order Invoice*`,
    `Order ID: #${shortId}`,
    `Delivery Slot: ${order.slot_label}`,
    '',
    '*Ordered Items:*',
    ...items.map(item => `• ${item.name} (${item.unit}) × ${item.quantity} = ${formatRupees(item.price * item.quantity)}`),
    '',
    `Subtotal: ${formatRupees(subtotal)}`,
    ...(discount > 0 ? [`Coupon (${order.coupon_code || 'DISCOUNT'}): -${formatRupees(discount)}`] : []),
    `Delivery Fee: ${fee === 0 ? 'FREE' : formatRupees(fee)}`,
    `*Total Payable on Delivery: ${formatRupees(order.total)}*`,
    '',
    `Address: ${order.address}`,
    `Thank you for ordering from ${SHOP_NAME}!`
  ];
  return 'https://wa.me/' + target + '?text=' + encodeURIComponent(lines.join('\n'));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function buildInvoice(order, heading, subtitle, options = {}) {
  const items = Array.isArray(order.items) ? order.items : JSON.parse(order.items || '[]');
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = Number(order.coupon_discount || 0);
  const fee = Number(order.fee || 0);
  const total = Number(order.total || 0);
  const shortId = String(order.id).slice(0, 8).toUpperCase();
  const adminWa = normalizeWhatsApp(options.adminWhatsApp || DEFAULT_ADMIN_WHATSAPP);
  const customerWaLink = options.forAdmin ? whatsappInvoiceLink(order.phone, order) : '';
  const supportWaLink = !options.forAdmin && adminWa
    ? 'https://wa.me/' + adminWa + '?text=' + encodeURIComponent(`Hi ${SHOP_NAME}, regarding Order #${shortId}`)
    : '';

  const textLines = [
    `${SHOP_NAME} — ${heading}`,
    subtitle,
    '',
    `Order ID: ${order.id} (#${shortId})`,
    `Status: ${order.status}`,
    `Delivery Slot: ${order.slot_label}`,
    `Phone: ${order.phone}`,
    `Address: ${order.address}`,
    '',
    'Ordered Items:',
    ...items.map(item => `- ${item.name} (${item.unit}) x ${item.quantity} = ${formatRupees(item.price * item.quantity)}`),
    '',
    `Subtotal: ${formatRupees(subtotal)}`,
    ...(discount > 0 ? [`Coupon (${order.coupon_code || 'DISCOUNT'}): -${formatRupees(discount)}`] : []),
    `Delivery Fee: ${fee === 0 ? 'FREE' : formatRupees(fee)}`,
    `Total Payable on Delivery: ${formatRupees(total)}`,
    '',
    ...(customerWaLink ? [`Send WhatsApp Invoice to Customer: ${customerWaLink}`] : []),
    ...(supportWaLink ? [`WhatsApp ${SHOP_NAME} Support (+${adminWa}): ${supportWaLink}`] : []),
    `Thank you for ordering from ${SHOP_NAME}!`
  ];

  const rowsHtml = items.map(item => `<tr>
    <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.name)}</td>
    <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.unit)}</td>
    <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity}</td>
    <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatRupees(item.price * item.quantity)}</td>
  </tr>`).join('');

  const ctaHtml = customerWaLink
    ? `<p style="margin:18px 0 0;"><a href="${escapeHtml(customerWaLink)}" style="display:inline-block;background:#5a3e2b;color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold;">Send WhatsApp Invoice to Customer</a></p>`
    : supportWaLink
      ? `<p style="margin:18px 0 0;font-size:13px;color:#6c5b4d;">Need help? <a href="${escapeHtml(supportWaLink)}" style="color:#5a3e2b;font-weight:bold;">WhatsApp ${SHOP_NAME} (+${escapeHtml(adminWa)})</a></p>`
      : '';

  const htmlContent = `<div style="margin:0;padding:16px 10px;background:#f7f4eb;font-family:system-ui,-apple-system,Arial,sans-serif;color:#35271e;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e1d8ca;border-radius:12px;overflow:hidden;">
    <div style="background:#5a3e2b;color:#ffffff;padding:16px 20px;">
      <h2 style="margin:0;font-family:Georgia,serif;font-size:20px;">${SHOP_NAME}</h2>
      <p style="margin:4px 0 0;font-size:13px;opacity:0.9;">${escapeHtml(heading)} · #${escapeHtml(shortId)}</p>
    </div>
    <div style="padding:20px;">
      <p style="margin-top:0;">${escapeHtml(subtitle)}</p>
      <p style="font-size:13px;color:#6c5b4d;line-height:1.55;">
        <strong>Order ID:</strong> ${escapeHtml(order.id)}<br>
        <strong>Delivery Slot:</strong> ${escapeHtml(order.slot_label)}<br>
        <strong>Phone:</strong> ${escapeHtml(order.phone)}<br>
        <strong>Delivery Address:</strong> ${escapeHtml(order.address)}
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
        <thead>
          <tr style="background:#f7f4eb;text-align:left;color:#5a3e2b;">
            <th style="padding:8px;">Item</th>
            <th style="padding:8px;">Pack</th>
            <th style="padding:8px;text-align:center;">Qty</th>
            <th style="padding:8px;text-align:right;">Amount</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <table style="width:100%;font-size:14px;margin-top:8px;">
        <tr><td style="padding:4px 0;color:#6c5b4d;">Subtotal</td><td style="text-align:right;">${formatRupees(subtotal)}</td></tr>
        ${discount > 0 ? `<tr><td style="padding:4px 0;color:#5a3e2b;font-weight:600;">Coupon (${escapeHtml(order.coupon_code || 'DISCOUNT')})</td><td style="text-align:right;color:#5a3e2b;font-weight:600;">-${formatRupees(discount)}</td></tr>` : ''}
        <tr><td style="padding:4px 0;color:#6c5b4d;">Delivery Fee</td><td style="text-align:right;">${fee === 0 ? 'FREE' : formatRupees(fee)}</td></tr>
        <tr><td style="padding:8px 0 0;font-weight:bold;color:#5a3e2b;border-top:1px solid #e1d8ca;">Total Payable on Delivery</td><td style="padding:8px 0 0;text-align:right;font-weight:bold;color:#5a3e2b;border-top:1px solid #e1d8ca;">${formatRupees(total)}</td></tr>
      </table>
      ${ctaHtml}
    </div>
  </div>
  </div>`;

  return { shortId, textContent: textLines.join('\n'), htmlContent };
}

async function sendEmail(env, recipients, subject, textContent, htmlContent) {
  if (!env?.BREVO_API_KEY || !env?.BREVO_SENDER || !recipients.length) return;
  try {
    await (env.sendLocalEmail ?? fetch)('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { email: env.BREVO_SENDER, name: SHOP_NAME },
        to: recipients.map(email => ({ email })),
        subject,
        textContent,
        htmlContent
      })
    });
  } catch {
    // Notification failures must not break checkout or admin booking decisions.
  }
}

function scheduleNotification(env, ctx, task) {
  if (ctx?.waitUntil) {
    ctx.waitUntil(task);
    return;
  }
  if (env?.sendLocalEmail) return task;
  task.catch(() => {});
}

export async function notifyOrderPlaced(env, db, ctx, order) {
  if (!env?.BREVO_API_KEY || !env?.BREVO_SENDER) return;
  const task = (async () => {
    const customerInvoice = buildInvoice(
      order,
      'Order Invoice (Received)',
      'Thank you for your order! We have received your booking and will confirm it shortly.',
      { adminWhatsApp: env.ADMIN_WHATSAPP, forAdmin: false }
    );
    const adminInvoice = buildInvoice(
      order,
      'New Order Received',
      `New order placed by ${order.email} (${order.phone}). Open the Admin portal to Accept or Reject.`,
      { adminWhatsApp: env.ADMIN_WHATSAPP, forAdmin: true }
    );
    const admins = await db.prepare("SELECT email FROM users WHERE role='admin'").all()
      .then(res => res.results.map(row => row.email))
      .catch(() => []);
    await Promise.all([
      sendEmail(
        env,
        [order.email],
        `${SHOP_NAME} Invoice — Order Received (#${customerInvoice.shortId})`,
        customerInvoice.textContent,
        customerInvoice.htmlContent
      ),
      admins.length ? sendEmail(
        env,
        admins,
        `New Order #${adminInvoice.shortId} · ${formatRupees(order.total)} — ${SHOP_NAME}`,
        adminInvoice.textContent,
        adminInvoice.htmlContent
      ) : Promise.resolve()
    ]);
  })();
  return scheduleNotification(env, ctx, task);
}

export async function notifyOrderDecision(env, ctx, order) {
  if (!env?.BREVO_API_KEY || !env?.BREVO_SENDER || !order?.email) return;
  const templates = {
    Confirmed: {
      heading: 'Order Confirmed',
      subtitle: `Good news! Your ${SHOP_NAME} order is confirmed and will be delivered in your selected slot.`,
      subjectPrefix: `${SHOP_NAME} Invoice — Order Confirmed`
    },
    Delivered: {
      heading: 'Order Delivered',
      subtitle: `Your ${SHOP_NAME} order has been delivered. Thank you for shopping with us!`,
      subjectPrefix: `${SHOP_NAME} Invoice — Order Delivered`
    },
    Rejected: {
      heading: 'Order Not Accepted',
      subtitle: `Sorry, we could not fulfill your ${SHOP_NAME} order at this time. No payment is due.`,
      subjectPrefix: `${SHOP_NAME} Order Update — Could Not Be Fulfilled`
    }
  };
  const template = templates[order.status];
  if (!template) return;
  const invoice = buildInvoice(order, template.heading, template.subtitle, { adminWhatsApp: env.ADMIN_WHATSAPP, forAdmin: false });
  const task = sendEmail(
    env,
    [order.email],
    `${template.subjectPrefix} (#${invoice.shortId})`,
    invoice.textContent,
    invoice.htmlContent
  );
  return scheduleNotification(env, ctx, task);
}

