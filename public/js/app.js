(() => {
  const $ = id => document.getElementById(id);
  const API = '';
  const CART_KEY = 'shemart_cart_v1';
  const TOKEN_KEY = 'shemart_token';
  const USER_KEY = 'shemart_user';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => `₹${Number(value || 0).toFixed(2)}`;
  const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
  const getUser = () => { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } };
  const setSession = data => { localStorage.setItem(TOKEN_KEY, data.token); localStorage.setItem(USER_KEY, JSON.stringify(data.user)); };
  const clearSession = () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); };
  const authHeaders = () => getToken() ? { Authorization: `Bearer ${getToken()}` } : {};
  async function api(path, options = {}) {
    const headers = { ...(options.body ? {'Content-Type':'application/json'} : {}), ...authHeaders(), ...(options.headers || {}) };
    const response = await fetch(`${API}${path}`, { ...options, headers });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status})`);
    return data;
  }
  function notice(element, message, type = '') {
    if (!element) return;
    element.className = `notice${type ? ` ${type}` : ''}`;
    element.textContent = message;
    element.classList.remove('hidden');
  }
  function hideNotice(element) { if (element) element.classList.add('hidden'); }
  function cartRead() { try { const c = JSON.parse(localStorage.getItem(CART_KEY) || '[]'); return Array.isArray(c) ? c : []; } catch { return []; } }
  function cartWrite(cart) { localStorage.setItem(CART_KEY, JSON.stringify(cart)); updateCartCount(); }
  function updateCartCount() { const count = cartRead().reduce((n, item) => n + Number(item.qty || 0), 0); const el = $('cartCount'); if (el) el.textContent = count; }
  function addToCart(product) {
    const cart = cartRead(); const found = cart.find(item => item.productId === product._id);
    if (found) found.qty = Math.min(20, found.qty + 1); else cart.push({ productId: product._id, qty: 1, title: product.title, price: product.price, imageUrl: product.imageUrl || '' });
    cartWrite(cart);
  }
  function cartSubtotal(cart = cartRead()) { return cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0); }

  async function initShop() {
    const grid = $('productGrid'); if (!grid) return;
    const category = $('categoryFilter'), search = $('searchInput'); let timer;
    async function load() {
      grid.innerHTML = '<div class="empty">Finding thoughtful products…</div>';
      const params = new URLSearchParams();
      if (category?.value && category.value !== 'All') params.set('category', category.value);
      if (search?.value.trim()) params.set('search', search.value.trim());
      try {
        const result = await api(`/api/products?${params}`); const products = result.data || [];
        if (!products.length) { grid.innerHTML = '<div class="empty">No products found yet. Please check back soon.</div>'; return; }
        grid.innerHTML = products.map(p => `<article class="product-card"><div class="product-image"><img src="${esc(p.imageUrl || '')}" alt="${esc(p.title)}" loading="lazy" onerror="this.style.display='none'"></div><div class="product-body"><span class="pill">${esc(p.category || 'Handmade')}</span><h3>${esc(p.title)}</h3><p>${esc((p.description || '').slice(0,130))}</p><p class="muted small">By ${esc(p.sellerName || 'SheMart seller')}</p><div class="product-footer"><span class="price">${money(p.price)}</span><button type="button" data-add="${esc(p._id)}">Add to cart</button></div></div></article>`).join('');
        grid.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => {
          const product = products.find(p => p._id === button.dataset.add); if (!product) return;
          addToCart(product); const old = button.textContent; button.textContent = 'Added ✓'; setTimeout(() => { button.textContent = old; }, 900);
        }));
      } catch (error) { grid.innerHTML = `<div class="empty">${esc(error.message)}<br><small>Make sure the SheMart server is running.</small></div>`; }
    }
    category?.addEventListener('change', load); search?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
    await load(); updateCartCount();
  }

  async function initAuth() {
    const loginForm = $('loginForm'); if (!loginForm) return;
    const registerForm = $('registerForm'), message = $('authMessage'), loginTab = $('showLogin'), registerTab = $('showRegister'), role = $('registerRole'), sellerFields = $('sellerFields');
    function show(which) {
      const register = which === 'register'; loginForm.classList.toggle('hidden', register); registerForm.classList.toggle('hidden', !register);
      loginTab.classList.toggle('secondary', register); registerTab.classList.toggle('secondary', !register); hideNotice(message);
    }
    loginTab.addEventListener('click', () => show('login')); registerTab.addEventListener('click', () => show('register'));
    role?.addEventListener('change', () => sellerFields?.classList.toggle('hidden', role.value !== 'seller'));
    if (new URLSearchParams(location.search).get('role') === 'seller') { show('register'); if (role) { role.value = 'seller'; role.dispatchEvent(new Event('change')); } }
    if (getToken()) { try { const me = await api('/api/auth/me'); notice(message, `Signed in as ${me.user.name} (${me.user.role}).`, 'success'); } catch { clearSession(); } }
    loginForm.addEventListener('submit', async e => {
      e.preventDefault(); hideNotice(message);
      try { const data = await api('/api/auth/login', { method:'POST', body: JSON.stringify({ email: $('loginEmail').value, password: $('loginPassword').value }) }); setSession(data); notice(message, 'Signed in successfully. Redirecting…', 'success'); location.href = data.user.role === 'seller' ? '/seller.html' : '/account.html'; }
      catch (error) { notice(message, error.message, 'error'); }
    });
    registerForm.addEventListener('submit', async e => {
      e.preventDefault(); hideNotice(message);
      const chosenRole = role.value;
      const body = { name:$('registerName').value, email:$('registerEmail').value, password:$('registerPassword').value, role:chosenRole };
      if (chosenRole === 'seller') Object.assign(body, { businessName:$('businessName').value, city:$('city').value, category:$('sellerCategory').value });
      try {
        const data = await api('/api/auth/register', { method:'POST', body:JSON.stringify(body) });
        let extra = data.emailSent ? ' Check your inbox for the verification link.' : ' Email delivery is not configured yet.';
        notice(message, data.message + extra, data.emailSent ? 'success' : '');
        if (data.developmentVerificationUrl) { const link = document.createElement('a'); link.href = data.developmentVerificationUrl; link.textContent = 'Open development verification link'; link.style.display = 'block'; link.style.marginTop = '.7rem'; message.appendChild(document.createElement('br')); message.appendChild(link); }
        registerForm.reset(); sellerFields?.classList.add('hidden');
      } catch (error) { notice(message, error.message, 'error'); }
    });
    $('resendVerification')?.addEventListener('click', async () => {
      const email = $('loginEmail').value.trim(); if (!email) return notice(message, 'Enter your email in the sign-in form first.', 'error');
      try { const data = await api('/api/auth/resend-verification', { method:'POST', body:JSON.stringify({ email }) }); notice(message, data.message, 'success'); } catch (error) { notice(message, error.message, 'error'); }
    });
    try {
      const config = await api('/api/config');
      if (config.googleClientId) {
        const renderGoogle = () => {
          if (!window.google?.accounts?.id) return setTimeout(renderGoogle, 250);
          window.google.accounts.id.initialize({ client_id: config.googleClientId, callback: async response => {
            try { const data = await api('/api/auth/google', { method:'POST', body:JSON.stringify({ credential:response.credential }) }); setSession(data); location.href = data.user.role === 'seller' ? '/seller.html' : '/account.html'; }
            catch (error) { notice(message, error.message, 'error'); }
          } });
          window.google.accounts.id.renderButton($('googleSignIn'), { theme:'outline', size:'large', shape:'pill', width:360, text:'continue_with' });
        }; renderGoogle();
      } else $('googleSignIn').innerHTML = '<p class="muted small">Google Sign-In becomes available after GOOGLE_CLIENT_ID is configured.</p>';
    } catch {}
  }

  async function initVerify() {
    const message = $('verifyMessage'); if (!message) return;
    const token = new URLSearchParams(location.search).get('token');
    if (!token) { message.textContent = 'This verification link is incomplete. Request a new email from the sign-in page.'; $('signInLink')?.classList.remove('hidden'); return; }
    try { const result = await api('/api/auth/verify-email', { method:'POST', body:JSON.stringify({ token }) }); message.textContent = result.message; $('signInLink')?.classList.remove('hidden'); }
    catch (error) { message.textContent = error.message; $('signInLink')?.classList.remove('hidden'); }
  }

  async function initCheckout() {
    const form = $('checkoutForm'); if (!form) return;
    const list = $('checkoutItems'), cart = cartRead(), msg = $('checkoutMessage'), user = getUser();
    updateCartCount();
    const subtotal = cartSubtotal(cart); $('subtotal').textContent = money(subtotal); $('total').textContent = money(subtotal);
    if (!cart.length) { list.innerHTML = '<div class="empty">Your cart is empty. <a href="/customer.html">Browse products</a>.</div>'; $('placeOrderButton').disabled = true; }
    else list.innerHTML = cart.map(item => `<div class="cart-line"><div><strong>${esc(item.title)}</strong><div class="muted small">${money(item.price)} each</div></div><div class="qty-controls"><button type="button" data-dec="${esc(item.productId)}" class="secondary">−</button><span>${item.qty}</span><button type="button" data-inc="${esc(item.productId)}" class="secondary">+</button></div><strong class="line-total">${money(item.price*item.qty)}</strong></div>`).join('');
    list.querySelectorAll('[data-dec]').forEach(b => b.addEventListener('click', () => changeQty(b.dataset.dec, -1)));
    list.querySelectorAll('[data-inc]').forEach(b => b.addEventListener('click', () => changeQty(b.dataset.inc, 1)));
    function changeQty(id, delta) { const next = cartRead().map(i => i.productId === id ? {...i, qty:i.qty+delta} : i).filter(i => i.qty > 0); cartWrite(next); location.reload(); }
    $('checkoutAuth').textContent = user ? `Signed in as ${user.email}` : 'You need to sign in before placing an order.';
    if (!getToken()) { $('checkoutAuth').innerHTML = 'Please <a href="/auth.html">sign in</a> or create a customer account before placing your order.'; $('placeOrderButton').disabled = true; }
    const config = await api('/api/config').catch(() => ({}));
    const method = $('paymentMethod'); if (!config.onlinePaymentsEnabled) { const option = method.querySelector('option[value="razorpay"]'); if (option) { option.textContent = 'Online payment (configure Razorpay first)'; option.disabled = true; } $('paymentHint').textContent = 'Online payment requires Razorpay test/live keys. Cash on Delivery is available now.'; }
    method.addEventListener('change', () => $('paymentHint').textContent = method.value === 'cod' ? 'Pay when your order is delivered.' : 'You will be redirected to secure Razorpay checkout.');
    form.addEventListener('submit', async e => {
      e.preventDefault(); hideNotice(msg); $('placeOrderButton').disabled = true;
      try {
        const result = await api('/api/orders', { method:'POST', body:JSON.stringify({ items:cartRead().map(i => ({ productId:i.productId, qty:i.qty })), shippingAddress:$('address').value, phone:$('phone').value, paymentMethod:method.value }) });
        if (method.value === 'cod') {
          localStorage.removeItem(CART_KEY); notice(msg, `Order ${result.order.orderNumber} placed. Payment is due on delivery.`, 'success');
          setTimeout(() => location.href = '/account.html', 1200); return;
        }
        if (!window.Razorpay || !result.payment) throw new Error('Razorpay checkout did not load. No payment was taken.');
        let paymentHandlerStarted = false;
        const checkout = new window.Razorpay({ key:result.payment.keyId, order_id:result.payment.orderId, amount:result.payment.amount, currency:result.payment.currency, name:'SheMart', description:`Order ${result.order.orderNumber}`, prefill:{ name:user?.name || '', email:user?.email || '', contact:$('phone').value }, theme:{ color:'#713b66' }, handler:async response => {
          paymentHandlerStarted = true;
          try { await api('/api/payments/verify', { method:'POST', body:JSON.stringify({ ...response, orderId:result.order._id }) }); localStorage.removeItem(CART_KEY); notice(msg, 'Payment verified and order confirmed. Redirecting to your orders…', 'success'); setTimeout(() => location.href='/account.html', 1200); }
          catch (error) { notice(msg, `Payment was submitted, but confirmation needs a refresh: ${error.message}. Check My Orders before retrying.`, 'error'); $('placeOrderButton').disabled = false; }
        }, modal:{ ondismiss:async () => { if (paymentHandlerStarted) return; try { await api(`/api/orders/${result.order._id}/cancel`, { method:'POST', body:JSON.stringify({}) }); notice(msg, 'Checkout closed. The pending order was cancelled and stock released.', ''); } catch { notice(msg, `Checkout closed. Order ${result.order.orderNumber} may still be awaiting payment; check My Orders before retrying.`, ''); } $('placeOrderButton').disabled = false; } } });
        checkout.on('payment.failed', response => { notice(msg, response.error?.description || 'Payment failed. No successful payment has been confirmed.', 'error'); $('placeOrderButton').disabled = false; }); checkout.open();
      } catch (error) { notice(msg, error.message, 'error'); $('placeOrderButton').disabled = false; }
    });
  }

  function orderCard(order, sellerMode = false) {
    const itemLines = order.items.map(item => `<li>${esc(item.title)} × ${item.qty} <span class="muted">(${money(item.price*item.qty)})</span>${sellerMode ? ` <span class="tag">${esc(item.status || 'placed')}</span>` : ''}</li>`).join('');
    const payment = order.paymentStatus === 'paid' ? 'good' : order.paymentStatus === 'cod-pending' ? 'warn' : '';
    const sellerStatus = order.items.every(item => item.status === 'delivered') ? 'delivered' : order.items.some(item => item.status === 'shipped') ? 'shipped' : order.items.some(item => item.status === 'confirmed') ? 'confirmed' : 'placed';
    const next = { placed:'confirmed', confirmed:'shipped', shipped:'delivered' }[sellerMode ? sellerStatus : order.status];
    return `<article class="order-card"><div class="row"><div><span class="eyebrow">${esc(order.orderNumber)}</span><h3>${new Date(order.createdAt).toLocaleString()}</h3></div><span class="tag">${esc(order.status.replaceAll('-', ' '))}</span></div><ul class="order-items">${itemLines}</ul><div class="row" style="margin-top:.7rem"><span class="muted">${esc(order.paymentMethod === 'cod' ? 'Cash on Delivery' : 'Online payment')} · <span class="tag ${payment}">${esc(order.paymentStatus.replaceAll('-', ' '))}</span></span><strong>${money(order.totalAmount)}</strong></div>${sellerMode && next ? `<button data-status-order="${esc(order._id)}" data-next-status="${next}" style="margin-top:.8rem">Mark ${next}</button>` : ''}${sellerMode && order.paymentMethod === 'cod' && order.paymentStatus === 'cod-pending' && order.status === 'delivered' ? `<button class="secondary" data-cod-paid="${esc(order._id)}" style="margin-top:.8rem">Record COD collected</button>` : ''}</article>`;
  }
  async function initAccount() {
    const list = $('ordersList'); if (!list) return;
    const user = getUser(); if (!getToken()) { list.innerHTML = '<div class="empty">Please <a href="/auth.html">sign in</a> to see your orders.</div>'; return; }
    $('accountWelcome').textContent = user ? `Hello ${user.name}. Here are your latest orders.` : '';
    $('logoutButton')?.addEventListener('click', () => { clearSession(); location.href='/'; });
    try { const data = await api('/api/orders/mine'); const orders = data.orders || []; list.innerHTML = orders.length ? orders.map(o => orderCard(o)).join('') : '<div class="empty">No orders yet. <a href="/customer.html">Find something you love</a>.</div>'; }
    catch (error) { list.innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
  }
  async function initSeller() {
    const form = $('addProductForm'); if (!form) return;
    const message = $('sellerMessage'), user = getUser();
    if (!getToken()) { notice(message, 'Sign in with a verified seller account to add products and manage orders.'); return; }
    try { const me = await api('/api/auth/me'); if (me.user.role !== 'seller') { notice(message, 'This account is a customer account. Create or sign in with a seller account to use Seller Studio.', 'error'); form.querySelector('button[type="submit"]').disabled = true; return; } notice(message, `Welcome, ${me.user.businessName || me.user.name}. You are signed in as a seller.`, 'success'); }
    catch (error) { notice(message, error.message, 'error'); return; }
    form.addEventListener('submit', async e => {
      e.preventDefault(); hideNotice(message);
      try { await api('/api/products', { method:'POST', body:JSON.stringify({ title:$('productName').value, category:$('productCategory').value, price:$('productPrice').value, stock:$('productStock').value, imageUrl:$('productImage').value, description:$('productDescription').value }) }); notice(message, 'Product published successfully.', 'success'); form.reset(); $('productStock').value = '20'; }
      catch (error) { notice(message, error.message, 'error'); }
    });
    await loadSellerOrders();
  }
  async function loadSellerOrders() {
    const list = $('sellerOrders'); if (!list) return;
    try { const data = await api('/api/orders/seller'); const orders = data.orders || []; list.innerHTML = orders.length ? orders.map(o => orderCard(o, true)).join('') : '<div class="empty">No orders yet. Your orders will appear here.</div>'; list.querySelectorAll('[data-status-order]').forEach(button => button.addEventListener('click', async () => { button.disabled = true; try { await api(`/api/orders/${button.dataset.statusOrder}/status`, { method:'PATCH', body:JSON.stringify({ status:button.dataset.nextStatus }) }); await loadSellerOrders(); } catch (error) { button.disabled = false; notice($('sellerMessage'), error.message, 'error'); } })); list.querySelectorAll('[data-cod-paid]').forEach(button => button.addEventListener('click', async () => { if (!confirm('Confirm that Cash on Delivery was actually collected?')) return; button.disabled = true; try { await api(`/api/orders/${button.dataset.codPaid}/cod-payment`, { method:'PATCH', body:JSON.stringify({}) }); await loadSellerOrders(); } catch (error) { button.disabled = false; notice($('sellerMessage'), error.message, 'error'); } })); }
    catch (error) { list.innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
  }
  function initSupport() {
    const form = $('supportForm'); if (!form) return;
    form.addEventListener('submit', async e => { e.preventDefault(); const noticeEl = $('supportNotice'); hideNotice(noticeEl); try { const result = await api('/api/support', { method:'POST', body:JSON.stringify({ name:$('supportName').value, email:$('supportEmail').value, message:$('supportMessageText').value }) }); notice(noticeEl, result.message, 'success'); form.reset(); } catch (error) { notice(noticeEl, error.message, 'error'); } });
  }
  document.addEventListener('DOMContentLoaded', () => { updateCartCount(); initShop(); initAuth(); initVerify(); initCheckout(); initAccount(); initSeller(); initSupport(); });
})();
