import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';

const PAGE_SIZES = [25, 50, 100, 250];
const STATUSES = ['جديد', 'تم التأكيد', 'قيد التحضير', 'تم الشحن', 'تم التسليم', 'مرتجع', 'ملغي'];

const ORDERS_QUERY = `#graphql
query Orders($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    nodes {
      id name createdAt updatedAt
      displayFinancialStatus displayFulfillmentStatus
      paymentGatewayNames
      totalPriceSet { shopMoney { amount currencyCode } }
      subtotalPriceSet { shopMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount currencyCode } }
      totalDiscountsSet { shopMoney { amount currencyCode } }
      customer { displayName email phone }
      email phone
      shippingAddress { name address1 address2 city province zip country }
      note
      tags
      lineItems(first: 50) { nodes { title quantity } }
      fulfillments(first: 20) { id status trackingInfo { company number url } }
      metafields(first: 4, namespace: "sidekick") { nodes { key value } }
    }
  }
}`;

const ORDER_UPDATE = `#graphql
mutation OrderUpdate($input: OrderInput!) {
  orderUpdate(input: $input) {
    order { id note }
    userErrors { field message }
  }
}`;

const METAFIELDS_SET = `#graphql
mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id namespace key value }
    userErrors { field message }
  }
}`;

function money(value: any) {
  return value?.shopMoney ? `${value.shopMoney.amount} ${value.shopMoney.currencyCode}` : '—';
}

function mapOrder(o: any) {
  const meta = Object.fromEntries((o.metafields?.nodes || []).map((m: any) => [m.key, m.value]));
  const fulfillment = o.fulfillments?.[0];
  const address = o.shippingAddress;
  return {
    ...o,
    customerName: o.customer?.displayName || address?.name || '—',
    email: o.customer?.email || o.email || '—',
    phone: o.customer?.phone || o.phone || address?.phone || '—',
    addressText: [address?.address1, address?.address2, address?.province, address?.country].filter(Boolean).join(', ') || '—',
    city: address?.city || '—',
    province: address?.province || '—',
    details: (o.lineItems?.nodes || []).map((x: any) => `${x.title} × ${x.quantity}`).join(' | ') || '—',
    quantity: (o.lineItems?.nodes || []).reduce((sum: number, x: any) => sum + Number(x.quantity || 0), 0),
    trackingNumber: meta.tracking_number_manual || fulfillment?.trackingInfo?.[0]?.number || '',
    shippingCompany: meta.shipping_company || fulfillment?.trackingInfo?.[0]?.company || '',
    customStatus: meta.sheet_status || '',
    note: o.note || '',
  };
}

function validate(row: any) {
  if (row.trackingNumber.includes(' ')) return 'Tracking number cannot contain spaces.';
  if (row.trackingNumber && row.trackingNumber.length < 4) return 'Tracking number must be at least 4 characters.';
  if (row.shippingCompany.length > 60) return 'Shipping company must be 60 characters or fewer.';
  if (row.note.length > 2000) return 'Notes must be 2,000 characters or fewer.';
  if (row.customStatus && !STATUSES.includes(row.customStatus)) return 'Custom status is not in the configured status list.';
  return '';
}

function App() {
  const [rows, setRows] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [readOnly, setReadOnly] = useState(false);

  async function loadOrders(next: string | null = null, searchValue = query) {
    setLoading(true);
    try {
      const result = await shopify.query(ORDERS_QUERY, {
        variables: { first: pageSize, after: next, query: searchValue || null },
      });
      if (result.errors?.length) throw new Error(result.errors.map((e: any) => e.message).join('; '));
      const connection = result.data.orders;
      const mapped = connection.nodes.map(mapOrder);
      setRows(mapped);
      setNextCursor(connection.pageInfo.endCursor || null);
      setHasNext(Boolean(connection.pageInfo.hasNextPage));
      setCursor(next);
      setSelected([]);
      setMessage(`${mapped.length} orders loaded`);
    } catch (e: any) {
      setMessage(`Error: ${e.message || 'Failed to load orders'}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadOrders(null, ''); }, [pageSize]);

  function updateRow(id: string, patch: any) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch, _dirty: true } : r));
  }

  async function saveRow(row: any) {
    const error = validate(row);
    if (error) { setMessage(`${row.name}: ${error}`); return false; }
    const metafields = [
      { ownerId: row.id, namespace: 'sidekick', key: 'sheet_status', type: 'single_line_text_field', value: row.customStatus || '' },
      { ownerId: row.id, namespace: 'sidekick', key: 'shipping_company', type: 'single_line_text_field', value: row.shippingCompany || '' },
      { ownerId: row.id, namespace: 'sidekick', key: 'tracking_number_manual', type: 'single_line_text_field', value: row.trackingNumber || '' },
    ];
    const orderResult = await shopify.query(ORDER_UPDATE, { variables: { input: { id: row.id, note: row.note || '' } } });
    if (orderResult.errors?.length || orderResult.data.orderUpdate.userErrors?.length) {
      throw new Error((orderResult.data?.orderUpdate?.userErrors || orderResult.errors).map((e: any) => e.message).join('; '));
    }
    const metaResult = await shopify.query(METAFIELDS_SET, { variables: { metafields } });
    if (metaResult.errors?.length || metaResult.data.metafieldsSet.userErrors?.length) {
      throw new Error((metaResult.data?.metafieldsSet?.userErrors || metaResult.errors).map((e: any) => e.message).join('; '));
    }
    return true;
  }

  async function saveAll() {
    const dirty = rows.filter(r => r._dirty);
    if (!dirty.length) { setMessage('No unsaved changes.'); return; }
    setSaving(true); setMessage('Saving changes…');
    let ok = 0, failed = 0;
    for (const row of dirty) {
      try { if (await saveRow(row)) ok++; } catch { failed++; }
    }
    setRows(prev => prev.map(r => r._dirty ? { ...r, _dirty: false } : r));
    setSaving(false);
    setMessage(`Saved ${ok}; failed ${failed}`);
  }

  function exportCsv() {
    const columns = ['Order #','Date','Name','Email','Phone','Address','City','Province','Order Details','Quantity','Total','Order Amount','Shipping Cost','Discount','Currency','Statuts','Tracking Number','Payment Method','Fulfillment Status','Status','Payment Gateway/Type','By (Shipping Co.)','Notes'];
    const esc = (v: any) => `"${String(v ?? '—').replaceAll('"', '""')}"`;
    const csv = '\ufeff' + [columns, ...rows.map(r => [r.name, new Date(r.createdAt).toLocaleString(), r.customerName, r.email, r.phone, r.addressText, r.city, r.province, r.details, r.quantity, money(r.totalPriceSet), money(r.subtotalPriceSet), money(r.totalShippingPriceSet), money(r.totalDiscountsSet), r.totalPriceSet?.shopMoney?.currencyCode || '—', r.displayFinancialStatus, r.trackingNumber || '—', (r.paymentGatewayNames || []).join(', ') || '—', r.displayFulfillmentStatus, r.customStatus || '—', (r.paymentGatewayNames || []).join(', ') || '—', r.shippingCompany || '—', r.note || '—']).map(esc)] .map(x => x.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `orders-sheet-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
    setMessage(`Exported ${rows.length} loaded orders.`);
  }

  const selectedCount = selected.length;
  const metrics = useMemo(() => ({
    count: rows.length,
    total: rows.reduce((s, r) => s + Number(r.totalPriceSet?.shopMoney?.amount || 0), 0),
    unfulfilled: rows.filter(r => r.displayFulfillmentStatus !== 'FULFILLED').length,
    noStatus: rows.filter(r => !r.customStatus).length,
    noTracking: rows.filter(r => !r.trackingNumber).length,
  }), [rows]);

  return (
    <s-page heading="KSV Orders Sheet Manager DRM">
      <s-section heading="Orders Sheet">
        <s-stack direction="inline" gap="base" align="end">
          <s-text-field label="Search" value={search} onChange={(e: any) => setSearch(e.currentTarget.value)} placeholder="Order number, name, email, phone, city, tracking" />
          <s-button variant="primary" onClick={() => { setQuery(search.trim()); loadOrders(null, search.trim()); }}>Search</s-button>
          <s-button onClick={() => loadOrders(cursor, query)}>Refresh</s-button>
          <s-button onClick={exportCsv}>Export CSV</s-button>
          <s-button variant="primary" onClick={saveAll} disabled={saving || readOnly}>{saving ? 'Saving…' : 'Save all changes'}</s-button>
        </s-stack>
        <s-stack direction="inline" gap="base">
          <s-select label="Page size" value={String(pageSize)} onChange={(e: any) => setPageSize(Number(e.currentTarget.value))}>
            {PAGE_SIZES.map(n => <s-option key={n} value={String(n)}>{n}</s-option>)}
          </s-select>
          <s-checkbox checked={readOnly} onChange={(e: any) => setReadOnly(Boolean(e.currentTarget.checked))}>Read-only mode</s-checkbox>
          <s-text>{metrics.count} orders · Total {metrics.total.toFixed(2)} · Unfulfilled {metrics.unfulfilled} · No status {metrics.noStatus} · No tracking {metrics.noTracking}</s-text>
        </s-stack>
        {message && <s-banner tone={message.startsWith('Error') ? 'critical' : 'info'}>{message}</s-banner>}
        {selectedCount > 0 && <s-banner>{selectedCount} selected. Bulk editing will be added in the next phase.</s-banner>}
      </s-section>

      <s-section heading="Orders">
        {loading ? <s-spinner accessibilityLabel="Loading orders" /> : (
          <s-table>
            <s-table-header-row>
              <s-table-header><s-checkbox checked={selected.length === rows.length && rows.length > 0} onChange={(e: any) => setSelected(e.currentTarget.checked ? rows.map(r => r.id) : [])} /></s-table-header>
              <s-table-header>Order #</s-table-header><s-table-header>Date</s-table-header><s-table-header>Name</s-table-header><s-table-header>Phone</s-table-header><s-table-header>City</s-table-header><s-table-header>Order Details</s-table-header><s-table-header>Total</s-table-header><s-table-header>Statuts</s-table-header><s-table-header>Tracking Number</s-table-header><s-table-header>By (Shipping Co.)</s-table-header><s-table-header>Notes</s-table-header><s-table-header>Save</s-table-header>
            </s-table-header-row>
            {rows.map(r => (
              <s-table-row key={r.id}>
                <s-table-cell><s-checkbox checked={selected.includes(r.id)} onChange={(e: any) => setSelected(p => e.currentTarget.checked ? [...p, r.id] : p.filter(x => x !== r.id))} /></s-table-cell>
                <s-table-cell><s-link href={`shopify:admin/orders/${r.id.split('/').pop()}`}>{r.name}</s-link></s-table-cell>
                <s-table-cell>{new Date(r.createdAt).toLocaleString()}</s-table-cell>
                <s-table-cell>{r.customerName}</s-table-cell>
                <s-table-cell>{r.phone}</s-table-cell>
                <s-table-cell>{r.city}</s-table-cell>
                <s-table-cell>{r.details}</s-table-cell>
                <s-table-cell>{money(r.totalPriceSet)}</s-table-cell>
                <s-table-cell><s-select value={r.customStatus} disabled={readOnly} onChange={(e: any) => updateRow(r.id, { customStatus: e.currentTarget.value })}>{STATUSES.map(s => <s-option key={s} value={s}>{s}</s-option>)}</s-select></s-table-cell>
                <s-table-cell><s-text-field value={r.trackingNumber} disabled={readOnly} onChange={(e: any) => updateRow(r.id, { trackingNumber: e.currentTarget.value })} /></s-table-cell>
                <s-table-cell><s-text-field value={r.shippingCompany} disabled={readOnly} onChange={(e: any) => updateRow(r.id, { shippingCompany: e.currentTarget.value })} /></s-table-cell>
                <s-table-cell><s-text-field value={r.note} disabled={readOnly} onChange={(e: any) => updateRow(r.id, { note: e.currentTarget.value })} /></s-table-cell>
                <s-table-cell><s-button disabled={readOnly || !r._dirty || saving} onClick={async () => { try { await saveRow(r); updateRow(r.id, { _dirty: false }); setMessage(`${r.name} saved.`); } catch (e: any) { setMessage(`Error saving ${r.name}: ${e.message}`); } }}>Save</s-button></s-table-cell>
              </s-table-row>
            ))}
          </s-table>
        )}
        <s-stack direction="inline" gap="base" align="center">
          <s-button disabled={!cursor || loading} onClick={() => loadOrders(null, query)}>First</s-button>
          <s-button disabled={!hasNext || loading} onClick={() => loadOrders(nextCursor, query)}>Next</s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

render(<App />, document.body);
