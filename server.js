import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || '497781ec8fd2691747d174ff4dccde05';
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const API_VERSION = '2026-07';
const SCOPES = 'read_orders,read_customers';
const sessions = new Map();

function hmacValid(query) {
  const { hmac, ...rest } = query;
  if (!hmac) return false;
  const message = Object.keys(rest).sort().map((key) => `${key}=${rest[key]}`).join('&');
  const digest = crypto.createHmac('sha256', SHOPIFY_API_SECRET || '').update(message).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac)); } catch { return false; }
}

app.get('/health', (_req, res) => res.json({ ok: true, app: 'KSV Orders Sheet Manager DRM' }));

app.get('/auth', (req, res) => {
  const shop = String(req.query.shop || '').trim().toLowerCase();
  if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return res.status(400).send('Valid Shopify shop is required.');
  if (!APP_URL) return res.status(500).send('APP_URL is not configured.');
  const state = crypto.randomBytes(16).toString('hex');
  sessions.set(`state:${state}`, { shop, createdAt: Date.now() });
  const redirect = `${APP_URL}/auth/callback`;
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set('client_id', SHOPIFY_API_KEY);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

app.get('/auth/callback', async (req, res) => {
  const { shop, code, state } = req.query;
  const saved = sessions.get(`state:${state}`);
  sessions.delete(`state:${state}`);
  if (!saved || saved.shop !== shop || Date.now() - saved.createdAt > 10 * 60 * 1000 || !hmacValid(req.query)) return res.status(400).send('Invalid OAuth callback.');
  try {
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: SHOPIFY_API_KEY, client_secret: SHOPIFY_API_SECRET, code })
    });
    if (!tokenResponse.ok) throw new Error(await tokenResponse.text());
    const token = await tokenResponse.json();
    sessions.set(`shop:${shop}`, { shop, accessToken: token.access_token, createdAt: Date.now() });
    res.redirect(`/app?shop=${encodeURIComponent(shop)}`);
  } catch (error) {
    console.error(error);
    res.status(500).send('OAuth token exchange failed.');
  }
});

async function shopifyGraphQL(shop, query, variables = {}) {
  const session = sessions.get(`shop:${shop}`);
  if (!session?.accessToken) throw new Error('SHOP_NOT_AUTHENTICATED');
  const response = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
    body: JSON.stringify({ query, variables })
  });
  const body = await response.json();
  if (!response.ok || body.errors) throw new Error(JSON.stringify(body.errors || body));
  return body.data;
}

app.get('/api/orders', async (req, res) => {
  const shop = String(req.query.shop || '').trim().toLowerCase();
  const first = Math.min(Math.max(Number(req.query.first || 50), 1), 100);
  const after = req.query.after || null;
  const search = String(req.query.search || '').trim();
  if (!shop) return res.status(400).json({ error: 'shop is required' });
  const query = `query Orders($first:Int!,$after:String,$query:String){ orders(first:$first,after:$after,query:$query,sortKey:CREATED_AT,reverse:true){ pageInfo{hasNextPage,endCursor} nodes{ id name createdAt displayFinancialStatus displayFulfillmentStatus totalPriceSet{shopMoney{amount currencyCode}} customer{displayName email phone} shippingAddress{address1,address2,city,province,zip,country} fulfillments(first:10){trackingInfo{number company url}} tags note lineItems(first:20){nodes{title quantity variant{sku}}} } } }`;
  try {
    const data = await shopifyGraphQL(shop, query, { first, after, query: search || null });
    res.json(data.orders);
  } catch (error) {
    if (String(error.message).includes('SHOP_NOT_AUTHENTICATED')) return res.status(401).json({ error: 'SHOP_NOT_AUTHENTICATED' });
    console.error(error);
    res.status(500).json({ error: 'Failed to load orders' });
  }
});

app.get('/app', (_req, res) => res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KSV Orders Sheet Manager DRM</title><style>body{font-family:Inter,system-ui,sans-serif;margin:0;background:#f6f6f7;color:#202223}header{padding:18px 24px;background:#fff;border-bottom:1px solid #ddd;display:flex;justify-content:space-between;align-items:center}main{padding:20px}input,button{font:inherit;padding:9px 12px;border:1px solid #bbb;border-radius:6px}button{cursor:pointer;background:#fff}.table{overflow:auto;background:#fff;border:1px solid #ddd;border-radius:8px;margin-top:16px}table{border-collapse:collapse;width:100%;min-width:1100px}th,td{padding:10px;border-bottom:1px solid #eee;text-align:left;white-space:nowrap}th{background:#fafafa;position:sticky;top:0}.muted{color:#6d7175}</style></head><body><header><strong>KSV Orders Sheet Manager DRM</strong><span class="muted">Shopify Orders</span></header><main><div><input id="search" placeholder="Search name, phone or email"/><button onclick="load()">Search</button></div><div id="status" class="muted" style="margin-top:12px">Loading…</div><div class="table"><table><thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Phone</th><th>Payment</th><th>Fulfillment</th><th>Total</th><th>City</th><th>Tracking</th><th>Products</th></tr></thead><tbody id="rows"></tbody></table></div></main><script>const shop=new URLSearchParams(location.search).get('shop');async function load(){const q=document.getElementById('search').value;const r=await fetch('/api/orders?shop='+encodeURIComponent(shop)+'&first=50&search='+encodeURIComponent(q));const box=document.getElementById('status');if(r.status===401){box.innerHTML='Not connected. Open <a href="/auth?shop='+encodeURIComponent(shop)+'">Connect Shopify</a>.';return}if(!r.ok){box.textContent='Failed to load orders';return}const d=await r.json();document.getElementById('rows').innerHTML=d.nodes.map(o=>{const tr=o.fulfillments?.[0]?.trackingInfo?.[0]||{};return '<tr><td><b>'+o.name+'</b></td><td>'+new Date(o.createdAt).toLocaleString()+'</td><td>'+((o.customer?.displayName)||'—')+'</td><td>'+((o.customer?.phone)||'—')+'</td><td>'+((o.displayFinancialStatus)||'—')+'</td><td>'+((o.displayFulfillmentStatus)||'—')+'</td><td>'+o.totalPriceSet.shopMoney.amount+' '+o.totalPriceSet.shopMoney.currencyCode+'</td><td>'+((o.shippingAddress?.city)||'—')+'</td><td>'+((tr.number)||'—')+'</td><td>'+o.lineItems.nodes.map(x=>x.title+' × '+x.quantity).join('<br>')+'</td></tr>'}).join('');box.textContent=d.nodes.length+' orders loaded';}if(shop)load();else document.getElementById('status').textContent='Open this app from Shopify Admin with a shop parameter.';</script></body></html>`));

app.listen(PORT, () => console.log(`KSV Orders Sheet Manager DRM listening on ${PORT}`));
