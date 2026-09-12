import { render } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';

interface Draft {
  status: string;
  tracking: string;
  company: string;
  note: string;
}

interface OrderRow {
  id: string;
  name: string;
  createdAt: string;
  note: string;
  customerName: string;
  customerEmail: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  discount: string;
  details: string;
  moreItems: boolean;
  quantity: number;
  total: string;
  subtotal: string;
  shipping: string;
  currency: string;
  financial: string;
  fulfillment: string;
  paymentMethods: string;
  gatewayTypes: string;
  fulfillmentTracking: string;
  fulfillmentCompany: string;
  fulfillmentId: string;
  fulfillmentOptions: { id: string; label: string }[];
  notesLog: { text: string; at: string }[];
  sheetStatus: string;
  shippingCompany: string;
  manualTracking: string;
}

interface PageInfoState {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

const PAGE_SIZE = 50;
const NAMESPACE = 'sidekick';
const STATUS_KEY = 'sheet_status';
const COMPANY_KEY = 'shipping_company';
const TRACKING_KEY = 'tracking_number_manual';

const PREFS_TYPE = 'sidekick_orders_sheet_prefs';
const PREFS_HANDLE = 'orders-sheet-default';
const DRAFTS_TYPE = 'sidekick_orders_sheet_drafts';
const DRAFTS_HANDLE = 'orders-sheet-drafts';
const LOG_TYPE = 'sidekick_orders_sheet_log';
const NOTES_LOG_KEY = 'notes_log';
const MAX_EXPORT_PAGES = 20;
const EXPORT_PAGE_SIZE = 250;
const LOG_PAGE_SIZE = 50;
const MAX_NOTES_HISTORY = 20;
const MAX_NOTE_LENGTH = 2000;
const MAX_COMPANY_LENGTH = 60;
const MIN_TRACKING_LENGTH = 4;

const FIELD_LABELS: Record<string, string> = {
  status: 'الحالة المخصصة',
  company: 'شركة الشحن',
  tracking: 'رقم التتبع',
  note: 'الملاحظات',
  fulfillment_tracking: 'تتبع التنفيذ الفعلي',
};

const DEFAULT_STATUS_CHOICES: string[] = [
  'جديد',
  'تم التأكيد',
  'قيد التحضير',
  'تم الشحن',
  'تم التسليم',
  'مرتجع',
  'ملغي',
];

const DEFINITIONS: { key: string; name: string; description: string; type: string }[] = [
  {
    key: STATUS_KEY,
    name: 'Sheet status',
    type: 'single_line_text_field',
    description: 'حالة الطلب المخصصة التي يديرها فريق العمل من تطبيق جدول الطلبات.',
  },
  {
    key: COMPANY_KEY,
    name: 'Shipping company',
    type: 'single_line_text_field',
    description: 'شركة الشحن المسؤولة عن الطلب عند إدخالها يدويًا.',
  },
  {
    key: TRACKING_KEY,
    name: 'Tracking number (manual)',
    type: 'single_line_text_field',
    description: 'رقم التتبع المُدخل يدويًا عندما لا يوجد رقم تتبع في التنفيذ.',
  },
  {
    key: NOTES_LOG_KEY,
    name: 'Notes history',
    type: 'json',
    description: 'سجل الملاحظات السابقة للطلب كما أُدخلت من جدول الطلبات.',
  },
];

const DEFINITION_QUERY = `query OrderDefinition($key: String!) {
  metafieldDefinition(identifier: { ownerType: ORDER, namespace: "${NAMESPACE}", key: $key }) {
    id
  }
}`;

const DEFINITION_CREATE = `mutation CreateOrderDefinition($definition: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $definition) {
    createdDefinition {
      id
      key
    }
    userErrors {
      field
      message
      code
    }
  }
}`;

const ORDERS_QUERY = `query SheetOrders($first: Int, $after: String, $last: Int, $before: String, $query: String, $sortKey: OrderSortKeys, $reverse: Boolean) {
  orders(first: $first, after: $after, last: $last, before: $before, query: $query, sortKey: $sortKey, reverse: $reverse) {
    edges {
      node {
        id
        name
        createdAt
        note
        email
        currentSubtotalLineItemsQuantity
        displayFinancialStatus
        displayFulfillmentStatus
        paymentGatewayNames
        presentmentCurrencyCode
        currentTotalPriceSet {
          presentmentMoney {
            amount
            currencyCode
          }
        }
        currentSubtotalPriceSet {
          presentmentMoney {
            amount
          }
        }
        totalShippingPriceSet {
          presentmentMoney {
            amount
          }
        }
        currentTotalDiscountsSet {
          presentmentMoney {
            amount
          }
        }
        customer {
          displayName
          email
          phone
        }
        shippingAddress {
          name
          phone
          address1
          address2
          city
          province
          country
        }
        lineItems(first: 100) {
          edges {
            node {
              title
              quantity
            }
          }
          pageInfo {
            hasNextPage
          }
        }
        fulfillments {
          id
          status
          trackingInfo {
            company
            number
          }
        }
        transactions(first: 10) {
          gateway
          kind
        }
        sheetStatus: metafield(namespace: "${NAMESPACE}", key: "${STATUS_KEY}") {
          value
        }
        shippingCompanyField: metafield(namespace: "${NAMESPACE}", key: "${COMPANY_KEY}") {
          value
        }
        manualTracking: metafield(namespace: "${NAMESPACE}", key: "${TRACKING_KEY}") {
          value
        }
        notesLog: metafield(namespace: "${NAMESPACE}", key: "${NOTES_LOG_KEY}") {
          jsonValue
        }
      }
    }
    pageInfo {
      hasNextPage
      hasPreviousPage
      startCursor
      endCursor
    }
  }
}`;

const ORDER_UPDATE = `mutation UpdateOrderNote($input: OrderInput!) {
  orderUpdate(input: $input) {
    order {
      id
      note
    }
    userErrors {
      field
      message
    }
  }
}`;

const METAFIELDS_SET = `mutation SetSheetMetafields($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields {
      id
      key
      value
    }
    userErrors {
      field
      message
      code
    }
  }
}`;

const FULFILLMENT_TRACKING_UPDATE = `mutation UpdateFulfillmentTracking($fulfillmentId: ID!, $trackingInfoInput: FulfillmentTrackingInput!, $notifyCustomer: Boolean) {
  fulfillmentTrackingInfoUpdate(fulfillmentId: $fulfillmentId, trackingInfoInput: $trackingInfoInput, notifyCustomer: $notifyCustomer) {
    fulfillment {
      id
      trackingInfo {
        company
        number
      }
    }
    userErrors {
      field
      message
    }
  }
}`;

const METAOBJECT_DEFINITION_QUERY = `query SheetMetaobjectDefinition($type: String!) {
  metaobjectDefinitionByType(type: $type) {
    id
  }
}`;

const METAOBJECT_DEFINITION_CREATE = `mutation CreateSheetMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
  metaobjectDefinitionCreate(definition: $definition) {
    metaobjectDefinition {
      id
      type
    }
    userErrors {
      field
      message
      code
    }
  }
}`;

const METAOBJECT_BY_HANDLE_QUERY = `query SheetMetaobjectByHandle($type: String!, $handle: String!, $key: String!) {
  metaobjectByHandle(handle: { type: $type, handle: $handle }) {
    id
    value: field(key: $key) {
      jsonValue
    }
  }
}`;

const LOG_CREATE = `mutation CreateSheetLogEntry($metaobject: MetaobjectCreateInput!) {
  metaobjectCreate(metaobject: $metaobject) {
    metaobject {
      id
      handle
    }
    userErrors {
      field
      message
      code
    }
  }
}`;

const LOG_QUERY = `query SheetLogEntries($first: Int!) {
  metaobjects(type: "${LOG_TYPE}", first: $first, sortKey: "updated_at", reverse: true) {
    edges {
      node {
        id
        updatedAt
        entry: field(key: "entry") {
          jsonValue
        }
      }
    }
  }
}`;

const METAOBJECT_UPSERT = `mutation UpsertSheetMetaobject($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
  metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
    metaobject {
      id
      handle
    }
    userErrors {
      field
      message
      code
    }
  }
}`;

const FINANCIAL_FILTERS: { value: string; label: string }[] = [
  { value: 'paid', label: 'مدفوع' },
  { value: 'pending', label: 'قيد الانتظار' },
  { value: 'partially_paid', label: 'مدفوع جزئيًا' },
  { value: 'refunded', label: 'مسترد' },
  { value: 'partially_refunded', label: 'مسترد جزئيًا' },
  { value: 'authorized', label: 'مُصرّح به' },
  { value: 'voided', label: 'ملغي الدفع' },
  { value: 'expired', label: 'منتهي' },
];

const FULFILLMENT_FILTERS: { value: string; label: string }[] = [
  { value: 'fulfilled', label: 'تم التنفيذ' },
  { value: 'null', label: 'غير منفّذ' },
  { value: 'partial', label: 'منفّذ جزئيًا' },
  { value: 'restocked', label: 'معاد للمخزون' },
];

const SORT_CHOICES: { value: string; label: string }[] = [
  { value: 'CREATED_AT', label: 'تاريخ الإنشاء' },
  { value: 'UPDATED_AT', label: 'آخر تحديث' },
  { value: 'ORDER_NUMBER', label: 'رقم الطلب' },
  { value: 'TOTAL_PRICE', label: 'قيمة الطلب' },
  { value: 'TOTAL_ITEMS_QUANTITY', label: 'عدد القطع' },
  { value: 'CUSTOMER_NAME', label: 'اسم العميل' },
];

const PAGE_SIZE_CHOICES: string[] = ['25', '50', '100', '250'];

const LATE_DAYS_CHOICES: string[] = ['1', '2', '3', '5', '7', '10'];

const ALERT_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'بدون تصفية' },
  { value: 'late', label: 'الطلبات المتأخرة' },
  { value: 'no-phone', label: 'بدون رقم هاتف' },
  { value: 'no-address', label: 'بدون عنوان كامل' },
  { value: 'no-tracking', label: 'بدون رقم تتبع' },
];

const CSV_HEADERS: string[] = [
  'Order #',
  'Date',
  'Name',
  'Email',
  'Phone',
  'Address',
  'City',
  'Province',
  'Order Details',
  'Quantity',
  'Total',
  'Order Amount',
  'Shipping Cost',
  'Discount',
  'Currency',
  'Statuts',
  'Tracking Number',
  'Payment Method',
  'Fulfillment Status',
  'Status',
  'Payment Gateway/Type',
  'By (Shipping Co.)',
  'Notes',
];

function csvCell(value: string): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function joinErrors(list: { field?: string[] | string | null; message: string }[]): string {
  return list
    .map((item) => {
      const field = item.field;
      const label = Array.isArray(field) ? field.join('.') : field;
      return label ? `${label}: ${item.message}` : item.message;
    })
    .join(', ');
}

function textOrDash(value: string): string {
  return value && value.trim().length > 0 ? value : '—';
}

function formatDate(value: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (isNaN(date.getTime())) return '—';
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function formatMoney(amount: string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const parsed = Number(amount);
  if (isNaN(parsed)) return '—';
  return parsed.toFixed(2);
}

function financialTone(status: string): 'success' | 'warning' | 'critical' | 'neutral' {
  if (status === 'PAID') return 'success';
  if (status === 'PARTIALLY_PAID' || status === 'PENDING' || status === 'AUTHORIZED')
    return 'warning';
  if (status === 'VOIDED' || status === 'EXPIRED') return 'critical';
  return 'neutral';
}

function fulfillmentTone(status: string): 'success' | 'warning' | 'neutral' {
  if (status === 'FULFILLED') return 'success';
  if (status === 'PARTIALLY_FULFILLED' || status === 'IN_PROGRESS' || status === 'SCHEDULED')
    return 'warning';
  return 'neutral';
}

function mapOrder(node: any): OrderRow {
  const shipping = node.shippingAddress;
  const addressParts: string[] = [];
  if (shipping?.address1) addressParts.push(shipping.address1);
  if (shipping?.address2) addressParts.push(shipping.address2);
  if (shipping?.province) addressParts.push(shipping.province);
  if (shipping?.country) addressParts.push(shipping.country);

  const lineItemEdges: any[] = node.lineItems?.edges ?? [];
  const details = lineItemEdges
    .map((edge: any) => `${edge.node.title} × ${edge.node.quantity}`)
    .join(', ');

  const fulfillments: any[] = node.fulfillments ?? [];
  let trackingNumber = '';
  let trackingCompany = '';
  let fulfillmentId = '';
  const fulfillmentOptions: { id: string; label: string }[] = [];
  fulfillments.forEach((fulfillment: any, index: number) => {
    if (!fulfillmentId && fulfillment.id) fulfillmentId = fulfillment.id;
    const infos: any[] = fulfillment.trackingInfo ?? [];
    infos.forEach((info: any) => {
      if (!trackingNumber && info.number) trackingNumber = info.number;
      if (!trackingCompany && info.company) trackingCompany = info.company;
    });
    if (fulfillment.id) {
      const ownNumber = infos[0]?.number ?? '';
      const ownCompany = infos[0]?.company ?? '';
      const parts: string[] = [`تنفيذ ${index + 1}`];
      if (fulfillment.status) parts.push(String(fulfillment.status));
      if (ownCompany) parts.push(ownCompany);
      if (ownNumber) parts.push(ownNumber);
      fulfillmentOptions.push({ id: fulfillment.id, label: parts.join(' – ') });
    }
  });

  const notesHistoryValue = node.notesLog?.jsonValue;
  const notesLog: { text: string; at: string }[] = Array.isArray(notesHistoryValue)
    ? notesHistoryValue
        .filter((item: any) => item && typeof item === 'object')
        .map((item: any) => ({
          text: typeof item.text === 'string' ? item.text : '',
          at: typeof item.at === 'string' ? item.at : '',
        }))
    : [];

  const transactions: any[] = node.transactions ?? [];
  const gatewayTypes = Array.from(
    new Set(
      transactions
        .filter((transaction: any) => transaction.gateway || transaction.kind)
        .map((transaction: any) => `${transaction.gateway ?? '—'} (${transaction.kind ?? '—'})`),
    ),
  ).join(', ');

  const gatewayNames: string[] = node.paymentGatewayNames ?? [];

  return {
    id: node.id,
    name: node.name ?? '',
    createdAt: node.createdAt ?? '',
    note: node.note ?? '',
    customerName: node.customer?.displayName || shipping?.name || '',
    customerEmail: node.customer?.email || node.email || '',
    phone: node.customer?.phone || shipping?.phone || '',
    address: addressParts.join(', '),
    city: shipping?.city ?? '',
    province: shipping?.province ?? '',
    discount: node.currentTotalDiscountsSet?.presentmentMoney?.amount ?? '',
    details,
    moreItems: node.lineItems?.pageInfo?.hasNextPage === true,
    quantity: node.currentSubtotalLineItemsQuantity ?? 0,
    total: node.currentTotalPriceSet?.presentmentMoney?.amount ?? '',
    subtotal: node.currentSubtotalPriceSet?.presentmentMoney?.amount ?? '',
    shipping: node.totalShippingPriceSet?.presentmentMoney?.amount ?? '',
    currency:
      node.presentmentCurrencyCode ||
      node.currentTotalPriceSet?.presentmentMoney?.currencyCode ||
      '',
    financial: node.displayFinancialStatus ?? '',
    fulfillment: node.displayFulfillmentStatus ?? '',
    paymentMethods: gatewayNames.join(', '),
    gatewayTypes,
    fulfillmentTracking: trackingNumber,
    fulfillmentCompany: trackingCompany,
    fulfillmentId,
    fulfillmentOptions,
    notesLog,
    sheetStatus: node.sheetStatus?.value ?? '',
    shippingCompany: node.shippingCompanyField?.value ?? '',
    manualTracking: node.manualTracking?.value ?? '',
  };
}

function orderToCsvRow(order: OrderRow): string {
  return [
    order.name,
    order.createdAt,
    order.customerName,
    order.customerEmail,
    order.phone,
    order.address,
    order.city,
    order.province,
    order.details,
    String(order.quantity),
    order.total,
    order.subtotal,
    order.shipping,
    order.discount,
    order.currency,
    order.financial,
    order.fulfillmentTracking || order.manualTracking,
    order.paymentMethods,
    order.fulfillment,
    order.sheetStatus,
    order.gatewayTypes,
    order.fulfillmentCompany || order.shippingCompany,
    order.note,
  ]
    .map(csvCell)
    .join(',');
}

function draftFromOrder(order: OrderRow): Draft {
  return {
    status: order.sheetStatus,
    tracking: order.manualTracking,
    company: order.shippingCompany,
    note: order.note,
  };
}

function isDirty(order: OrderRow, draft: Draft | undefined): boolean {
  if (!draft) return false;
  return (
    draft.status !== order.sheetStatus ||
    draft.tracking !== order.manualTracking ||
    draft.company !== order.shippingCompany ||
    draft.note !== order.note
  );
}

interface CellContext {
  order: OrderRow;
  draft: Draft;
  shortId: string;
  disabled: boolean;
  statusChoices: string[];
  selectedFulfillmentId: string;
  onChange: (patch: Partial<Draft>) => void;
  onSelectFulfillment: (fulfillmentId: string) => void;
}

interface LogEntry {
  id: string;
  orderId: string;
  orderName: string;
  field: string;
  oldValue: string;
  newValue: string;
  at: string;
}

interface PendingConfirm {
  kind: 'row' | 'all' | 'bulk';
  orderId: string;
}

interface SheetPreferences {
  hiddenColumnIds: string[];
  pinName: boolean;
  pinPhone: boolean;
  columnCount: number;
  showAllColumns: boolean;
  pageSize: number;
  sortKey: string;
  sortDescending: boolean;
  statusChoices: string[];
  writeToFulfillment: boolean;
  notifyCustomer: boolean;
  readOnlyMode: boolean;
  lateDays: number;
}

interface ColumnDef {
  id: string;
  header: string;
  format?: 'numeric' | 'currency';
  listSlot?: 'primary' | 'secondary' | 'kicker' | 'inline' | 'labeled';
  render: (context: CellContext) => any;
}

const ORDER_COLUMN: ColumnDef = {
  id: 'order',
  header: 'Order #',
  listSlot: 'primary',
  render: ({ order }: CellContext) => (
    <s-link href={`shopify://admin/orders?query=${encodeURIComponent(order.name)}`}>
      {textOrDash(order.name)}
    </s-link>
  ),
};

const SCROLL_COLUMNS: ColumnDef[] = [
  {
    id: 'date',
    header: 'Date',
    listSlot: 'kicker',
    render: ({ order }: CellContext) => formatDate(order.createdAt),
  },
  {
    id: 'name',
    header: 'Name',
    listSlot: 'secondary',
    render: ({ order }: CellContext) => textOrDash(order.customerName),
  },
  {
    id: 'email',
    header: 'Email',
    render: ({ order }: CellContext) => textOrDash(order.customerEmail),
  },
  {
    id: 'phone',
    header: 'Phone',
    render: ({ order }: CellContext) => textOrDash(order.phone),
  },
  {
    id: 'address',
    header: 'Address',
    render: ({ order }: CellContext) => textOrDash(order.address),
  },
  {
    id: 'city',
    header: 'City',
    render: ({ order }: CellContext) => textOrDash(order.city),
  },
  {
    id: 'province',
    header: 'Province',
    render: ({ order }: CellContext) => textOrDash(order.province),
  },
  {
    id: 'details',
    header: 'Order Details',
    render: ({ order }: CellContext) =>
      order.details ? `${order.details}${order.moreItems ? ' + المزيد' : ''}` : '—',
  },
  {
    id: 'quantity',
    header: 'Quantity',
    format: 'numeric',
    render: ({ order }: CellContext) => String(order.quantity),
  },
  {
    id: 'total',
    header: 'Total',
    format: 'currency',
    render: ({ order }: CellContext) => formatMoney(order.total),
  },
  {
    id: 'amount',
    header: 'Order Amount',
    format: 'currency',
    render: ({ order }: CellContext) => formatMoney(order.subtotal),
  },
  {
    id: 'shipping-cost',
    header: 'Shipping Cost',
    format: 'currency',
    render: ({ order }: CellContext) => formatMoney(order.shipping),
  },
  {
    id: 'discount',
    header: 'Discount',
    format: 'currency',
    render: ({ order }: CellContext) => formatMoney(order.discount),
  },
  {
    id: 'currency',
    header: 'Currency',
    render: ({ order }: CellContext) => textOrDash(order.currency),
  },
  {
    id: 'financial',
    header: 'Statuts',
    render: ({ order }: CellContext) =>
      order.financial ? (
        <s-badge tone={financialTone(order.financial)}>{order.financial}</s-badge>
      ) : (
        '—'
      ),
  },
  {
    id: 'tracking',
    header: 'Tracking Number',
    render: ({ order, draft, shortId, disabled, onChange }: CellContext) => (
      <s-stack gap="small-300">
        {order.fulfillmentTracking ? (
          <s-text color="subdued">{order.fulfillmentTracking}</s-text>
        ) : null}
        <s-text-field
          id={`tracking-field-${shortId}`}
          label="رقم التتبع"
          labelAccessibilityVisibility="exclusive"
          placeholder="رقم تتبع يدوي"
          value={draft.tracking}
          disabled={disabled}
          onInput={(event: any) => onChange({ tracking: event.currentTarget.value })}
        />
      </s-stack>
    ),
  },
  {
    id: 'payment-method',
    header: 'Payment Method',
    render: ({ order }: CellContext) => textOrDash(order.paymentMethods),
  },
  {
    id: 'fulfillment',
    header: 'Fulfillment Status',
    render: ({ order }: CellContext) =>
      order.fulfillment ? (
        <s-badge tone={fulfillmentTone(order.fulfillment)}>{order.fulfillment}</s-badge>
      ) : (
        '—'
      ),
  },
  {
    id: 'fulfillment-target',
    header: 'Fulfillment (target)',
    render: ({
      order,
      shortId,
      disabled,
      selectedFulfillmentId,
      onSelectFulfillment,
    }: CellContext) =>
      order.fulfillmentOptions.length === 0 ? (
        '—'
      ) : (
        <s-select
          id={`fulfillment-target-${shortId}`}
          label="التنفيذ المستهدف"
          labelAccessibilityVisibility="exclusive"
          value={selectedFulfillmentId}
          disabled={disabled}
          onChange={(event: any) => onSelectFulfillment(event.currentTarget.value)}
        >
          {order.fulfillmentOptions.map((option) => (
            <s-option key={option.id} value={option.id}>
              {option.label}
            </s-option>
          ))}
        </s-select>
      ),
  },
  {
    id: 'status',
    header: 'Status',
    render: ({ draft, shortId, disabled, statusChoices, onChange }: CellContext) => (
      <s-select
        id={`status-select-${shortId}`}
        label="الحالة"
        labelAccessibilityVisibility="exclusive"
        value={draft.status}
        disabled={disabled}
        onChange={(event: any) => onChange({ status: event.currentTarget.value })}
      >
        <s-option value="">بدون</s-option>
        {statusChoices.map((choice) => (
          <s-option key={choice} value={choice}>
            {choice}
          </s-option>
        ))}
        {draft.status !== '' && statusChoices.indexOf(draft.status) === -1 ? (
          <s-option value={draft.status}>{draft.status}</s-option>
        ) : null}
      </s-select>
    ),
  },
  {
    id: 'gateway',
    header: 'Payment Gateway/Type',
    render: ({ order }: CellContext) => textOrDash(order.gatewayTypes),
  },
  {
    id: 'carrier',
    header: 'By (Shipping Co.)',
    render: ({ order, draft, shortId, disabled, onChange }: CellContext) => (
      <s-stack gap="small-300">
        {order.fulfillmentCompany ? (
          <s-text color="subdued">{order.fulfillmentCompany}</s-text>
        ) : null}
        <s-text-field
          id={`company-field-${shortId}`}
          label="شركة الشحن"
          labelAccessibilityVisibility="exclusive"
          placeholder="شركة الشحن"
          value={draft.company}
          disabled={disabled}
          onInput={(event: any) => onChange({ company: event.currentTarget.value })}
        />
      </s-stack>
    ),
  },
  {
    id: 'notes',
    header: 'Notes',
    render: ({ order, draft, shortId, disabled, onChange }: CellContext) => (
      <s-stack gap="small-300">
        <s-text-area
          id={`notes-field-${shortId}`}
          label="الملاحظات"
          labelAccessibilityVisibility="exclusive"
          placeholder="أضف ملاحظة"
          rows={2}
          value={draft.note}
          disabled={disabled}
          onInput={(event: any) => onChange({ note: event.currentTarget.value })}
        />
        {order.notesLog.length > 0 ? (
          <s-text color="subdued">
            {`سجل الملاحظات (${String(order.notesLog.length)}): ${order.notesLog
              .slice(-3)
              .map((entry) => `${formatDate(entry.at)} — ${entry.text || 'بدون نص'}`)
              .join(' | ')}`}
          </s-text>
        ) : null}
      </s-stack>
    ),
  },
];

const COLUMN_COUNT_CHOICES: string[] = ['4', '6', '8', '10'];

function Extension() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [pageInfo, setPageInfo] = useState<PageInfoState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const [savingAll, setSavingAll] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [setupWarning, setSetupWarning] = useState<string>('');
  const [savedMessage, setSavedMessage] = useState<string>('');
  const [searchInput, setSearchInput] = useState<string>('');
  const [activeSearch, setActiveSearch] = useState<string>('');
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [showAllColumns, setShowAllColumns] = useState<boolean>(false);
  const [columnStart, setColumnStart] = useState<number>(0);
  const [columnCount, setColumnCount] = useState<number>(6);
  const [financialFilter, setFinancialFilter] = useState<string>('');
  const [fulfillmentFilter, setFulfillmentFilter] = useState<string>('');
  const [sheetStatusFilter, setSheetStatusFilter] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [sortKey, setSortKey] = useState<string>('CREATED_AT');
  const [sortDescending, setSortDescending] = useState<boolean>(true);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE);
  const [pinName, setPinName] = useState<boolean>(false);
  const [pinPhone, setPinPhone] = useState<boolean>(false);
  const [writeToFulfillment, setWriteToFulfillment] = useState<boolean>(false);
  const [notifyCustomer, setNotifyCustomer] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<string>('');
  const [bulkCompany, setBulkCompany] = useState<string>('');
  const [bulkTracking, setBulkTracking] = useState<string>('');
  const [bulkSaving, setBulkSaving] = useState<boolean>(false);
  const [hiddenColumnIds, setHiddenColumnIds] = useState<string[]>([]);
  const [jumpColumnId, setJumpColumnId] = useState<string>('');
  const [statusChoices, setStatusChoices] = useState<string[]>(DEFAULT_STATUS_CHOICES);
  const [newStatusName, setNewStatusName] = useState<string>('');
  const [prefsSaving, setPrefsSaving] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportUrl, setExportUrl] = useState<string>('');
  const [exportCount, setExportCount] = useState<number>(0);
  const [exportTruncated, setExportTruncated] = useState<boolean>(false);
  const [prefsWarning, setPrefsWarning] = useState<string>('');
  const [readOnlyMode, setReadOnlyMode] = useState<boolean>(false);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [logLoading, setLogLoading] = useState<boolean>(false);
  const [logWarning, setLogWarning] = useState<string>('');
  const [undoingId, setUndoingId] = useState<string>('');
  const [draftsSaving, setDraftsSaving] = useState<boolean>(false);
  const [savedDraftCount, setSavedDraftCount] = useState<number>(0);
  const [selectedFulfillmentIds, setSelectedFulfillmentIds] = useState<Record<string, string>>({});
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [lateDays, setLateDays] = useState<number>(3);
  const [alertFilter, setAlertFilter] = useState<string>('');
  const savedDraftsRef = useRef<Record<string, Draft>>({});

  const ensureDefinitions = useCallback(async (): Promise<void> => {
    const problems: string[] = [];

    for (const definition of DEFINITIONS) {
      try {
        const { data, errors } = await shopify.query(DEFINITION_QUERY, {
          variables: { key: definition.key },
        });

        if (errors?.length > 0) {
          problems.push(errors.map((item: any) => item.message).join(', '));
          continue;
        }

        if (data?.metafieldDefinition?.id) continue;

        const { data: createData, errors: createErrors } = await shopify.query(DEFINITION_CREATE, {
          variables: {
            definition: {
              name: definition.name,
              description: definition.description,
              namespace: NAMESPACE,
              key: definition.key,
              type: definition.type,
              ownerType: 'ORDER',
              access: { storefront: 'NONE' },
            },
          },
        });

        if (createErrors?.length > 0) {
          problems.push(createErrors.map((item: any) => item.message).join(', '));
          continue;
        }

        const userErrors = createData?.metafieldDefinitionCreate?.userErrors ?? [];
        if (userErrors.length > 0) {
          problems.push(joinErrors(userErrors));
        }
      } catch (err: any) {
        problems.push(err?.message ?? 'خطأ غير معروف');
      }
    }

    setSetupWarning(problems.length > 0 ? `تعذر تجهيز الحقول المخصصة: ${problems.join(', ')}` : '');
  }, []);

  const applyPreferences = useCallback((settings: any): void => {
    if (!settings || typeof settings !== 'object') return;
    if (Array.isArray(settings.hiddenColumnIds)) {
      setHiddenColumnIds(settings.hiddenColumnIds.filter((id: any) => typeof id === 'string'));
    }
    if (typeof settings.pinName === 'boolean') setPinName(settings.pinName);
    if (typeof settings.pinPhone === 'boolean') setPinPhone(settings.pinPhone);
    if (typeof settings.columnCount === 'number' && settings.columnCount > 0) {
      setColumnCount(settings.columnCount);
    }
    if (typeof settings.showAllColumns === 'boolean') setShowAllColumns(settings.showAllColumns);
    if (typeof settings.pageSize === 'number' && settings.pageSize > 0) {
      setPageSize(settings.pageSize);
    }
    if (
      typeof settings.sortKey === 'string' &&
      SORT_CHOICES.some((choice) => choice.value === settings.sortKey)
    ) {
      setSortKey(settings.sortKey);
    }
    if (typeof settings.sortDescending === 'boolean') setSortDescending(settings.sortDescending);
    if (Array.isArray(settings.statusChoices)) {
      const cleaned = settings.statusChoices.filter(
        (choice: any) => typeof choice === 'string' && choice.trim() !== '',
      );
      if (cleaned.length > 0) setStatusChoices(cleaned);
    }
    if (typeof settings.writeToFulfillment === 'boolean') {
      setWriteToFulfillment(settings.writeToFulfillment);
    }
    if (typeof settings.notifyCustomer === 'boolean') setNotifyCustomer(settings.notifyCustomer);
    if (typeof settings.readOnlyMode === 'boolean') setReadOnlyMode(settings.readOnlyMode);
    if (typeof settings.lateDays === 'number' && settings.lateDays > 0) {
      setLateDays(settings.lateDays);
    }
  }, []);

  const ensureMetaobjectDefinition = useCallback(
    async (type: string, name: string, fieldKey: string, description: string): Promise<string> => {
      const { data, errors } = await shopify.query(METAOBJECT_DEFINITION_QUERY, {
        variables: { type },
      });

      if (errors?.length > 0) {
        return errors.map((item: any) => item.message).join(', ');
      }

      if (data?.metaobjectDefinitionByType?.id) return '';

      const { data: createData, errors: createErrors } = await shopify.query(
        METAOBJECT_DEFINITION_CREATE,
        {
          variables: {
            definition: {
              name,
              type,
              access: { storefront: 'NONE' },
              fieldDefinitions: [{ name: 'Data', key: fieldKey, type: 'json', description }],
            },
          },
        },
      );

      if (createErrors?.length > 0) {
        return createErrors.map((item: any) => item.message).join(', ');
      }

      const definitionErrors = createData?.metaobjectDefinitionCreate?.userErrors ?? [];
      if (definitionErrors.length > 0) {
        return joinErrors(definitionErrors);
      }

      return '';
    },
    [],
  );

  const ensurePrefsDefinition = useCallback(
    (): Promise<string> =>
      ensureMetaobjectDefinition(
        PREFS_TYPE,
        'Orders sheet preferences',
        'settings',
        'إعدادات جدول الطلبات: الأعمدة والترتيب والحالات المخصصة.',
      ),
    [ensureMetaobjectDefinition],
  );

  const ensureDraftsDefinition = useCallback(
    (): Promise<string> =>
      ensureMetaobjectDefinition(
        DRAFTS_TYPE,
        'Orders sheet drafts',
        'drafts',
        'مسودات تعديلات جدول الطلبات قبل حفظها في الطلبات.',
      ),
    [ensureMetaobjectDefinition],
  );

  const ensureLogDefinition = useCallback(
    (): Promise<string> =>
      ensureMetaobjectDefinition(
        LOG_TYPE,
        'Orders sheet change log',
        'entry',
        'سجل تعديلات جدول الطلبات.',
      ),
    [ensureMetaobjectDefinition],
  );

  const loadPreferences = useCallback(async (): Promise<void> => {
    try {
      const definitionProblem = await ensurePrefsDefinition();
      if (definitionProblem) {
        setPrefsWarning(`تعذر تجهيز إعدادات الجدول: ${definitionProblem}`);
        return;
      }

      const { data, errors } = await shopify.query(METAOBJECT_BY_HANDLE_QUERY, {
        variables: { type: PREFS_TYPE, handle: PREFS_HANDLE, key: 'settings' },
      });

      if (errors?.length > 0) {
        setPrefsWarning(
          `تعذر تحميل التفضيلات المحفوطة: ${errors.map((item: any) => item.message).join(', ')}`,
        );
        return;
      }

      setPrefsWarning('');
      applyPreferences(data?.metaobjectByHandle?.value?.jsonValue);
    } catch (err: any) {
      setPrefsWarning(err?.message ?? 'تعذر تحميل التفضيلات المحفوطة');
    }
  }, [ensurePrefsDefinition, applyPreferences]);

  const loadDrafts = useCallback(async (): Promise<void> => {
    try {
      const definitionProblem = await ensureDraftsDefinition();
      if (definitionProblem) {
        setPrefsWarning(`تعذر تجهيز مسودات الجدول: ${definitionProblem}`);
        return;
      }

      const { data, errors } = await shopify.query(METAOBJECT_BY_HANDLE_QUERY, {
        variables: { type: DRAFTS_TYPE, handle: DRAFTS_HANDLE, key: 'drafts' },
      });

      if (errors?.length > 0) {
        setPrefsWarning(
          `تعذر تحميل المسودات المحفوطة: ${errors.map((item: any) => item.message).join(', ')}`,
        );
        return;
      }

      const stored = data?.metaobjectByHandle?.value?.jsonValue;
      if (!stored || typeof stored !== 'object') return;

      const cleaned: Record<string, Draft> = {};
      Object.keys(stored).forEach((orderId) => {
        const item: any = (stored as any)[orderId];
        if (item && typeof item === 'object') {
          cleaned[orderId] = {
            status: typeof item.status === 'string' ? item.status : '',
            tracking: typeof item.tracking === 'string' ? item.tracking : '',
            company: typeof item.company === 'string' ? item.company : '',
            note: typeof item.note === 'string' ? item.note : '',
          };
        }
      });

      savedDraftsRef.current = cleaned;
      setSavedDraftCount(Object.keys(cleaned).length);
      setDrafts((current) => {
        const merged: Record<string, Draft> = { ...current };
        Object.keys(merged).forEach((orderId) => {
          const savedDraft = cleaned[orderId];
          if (savedDraft) merged[orderId] = savedDraft;
        });
        return merged;
      });
    } catch (err: any) {
      setPrefsWarning(err?.message ?? 'تعذر تحميل المسودات المحفوطة');
    }
  }, [ensureDraftsDefinition]);

  const loadLog = useCallback(async (): Promise<void> => {
    setLogLoading(true);
    try {
      const definitionProblem = await ensureLogDefinition();
      if (definitionProblem) {
        setLogWarning(`تعذر تجهيز سجل التعديلات: ${definitionProblem}`);
        return;
      }

      const { data, errors } = await shopify.query(LOG_QUERY, {
        variables: { first: LOG_PAGE_SIZE },
      });

      if (errors?.length > 0) {
        setLogWarning(
          `تعذر تحميل سجل التعديلات: ${errors.map((item: any) => item.message).join(', ')}`,
        );
        return;
      }

      const edges: any[] = data?.metaobjects?.edges ?? [];
      const entries: LogEntry[] = [];
      edges.forEach((edge: any) => {
        const value = edge.node?.entry?.jsonValue;
        if (value && typeof value === 'object') {
          entries.push({
            id: edge.node.id,
            orderId: typeof value.orderId === 'string' ? value.orderId : '',
            orderName: typeof value.orderName === 'string' ? value.orderName : '',
            field: typeof value.field === 'string' ? value.field : '',
            oldValue: typeof value.oldValue === 'string' ? value.oldValue : '',
            newValue: typeof value.newValue === 'string' ? value.newValue : '',
            at: typeof value.at === 'string' ? value.at : (edge.node.updatedAt ?? ''),
          });
        }
      });

      setLogEntries(entries);
      setLogWarning('');
    } catch (err: any) {
      setLogWarning(err?.message ?? 'تعذر تحميل سجل التعديلات');
    } finally {
      setLogLoading(false);
    }
  }, [ensureLogDefinition]);

  const logChanges = async (
    order: OrderRow,
    changes: { field: string; oldValue: string; newValue: string }[],
  ): Promise<void> => {
    if (changes.length === 0) return;

    const definitionProblem = await ensureLogDefinition();
    if (definitionProblem) {
      setLogWarning(`تعذر تجهيز سجل التعديلات: ${definitionProblem}`);
      return;
    }

    for (const change of changes) {
      const { data, errors } = await shopify.query(LOG_CREATE, {
        variables: {
          metaobject: {
            type: LOG_TYPE,
            fields: [
              {
                key: 'entry',
                value: JSON.stringify({
                  orderId: order.id,
                  orderName: order.name,
                  field: change.field,
                  oldValue: change.oldValue,
                  newValue: change.newValue,
                  at: new Date().toISOString(),
                }),
              },
            ],
          },
        },
      });

      if (errors?.length > 0) {
        setLogWarning(
          `تعذر كتابة سجل التعديلات: ${errors.map((item: any) => item.message).join(', ')}`,
        );
        return;
      }

      const logErrors = data?.metaobjectCreate?.userErrors ?? [];
      if (logErrors.length > 0) {
        setLogWarning(`تعذر كتابة سجل التعديلات: ${joinErrors(logErrors)}`);
        return;
      }
    }

    setLogWarning('');
  };

  const buildQueryString = useCallback((): string | null => {
    const parts: string[] = [];
    const escaped = activeSearch.trim().replace(/"/g, '');
    if (escaped) {
      parts.push(
        escaped.indexOf(' ') !== -1
          ? `("${escaped}" OR city:"${escaped}" OR metafields.${NAMESPACE}.${COMPANY_KEY}:"${escaped}")`
          : `(name:${escaped}* OR email:${escaped}* OR city:"${escaped}" OR tracking_number:"${escaped}" OR metafields.${NAMESPACE}.${COMPANY_KEY}:"${escaped}" OR "${escaped}")`,
      );
    }
    if (financialFilter) parts.push(`financial_status:${financialFilter}`);
    if (fulfillmentFilter) parts.push(`fulfillment_status:${fulfillmentFilter}`);
    if (sheetStatusFilter) {
      parts.push(`metafields.${NAMESPACE}.${STATUS_KEY}:"${sheetStatusFilter}"`);
    }
    if (dateFrom) parts.push(`created_at:>=${dateFrom}`);
    if (dateTo) parts.push(`created_at:<=${dateTo}T23:59:59Z`);
    return parts.length > 0 ? parts.join(' AND ') : null;
  }, [activeSearch, financialFilter, fulfillmentFilter, sheetStatusFilter, dateFrom, dateTo]);

  const fetchOrders = useCallback(
    async (cursor: string | null, direction: 'forward' | 'backward'): Promise<void> => {
      setLoading(true);
      setError('');
      setSavedMessage('');

      try {
        const { data, errors } = await shopify.query(ORDERS_QUERY, {
          variables: {
            first: direction === 'forward' ? pageSize : null,
            after: direction === 'forward' ? cursor : null,
            last: direction === 'backward' ? pageSize : null,
            before: direction === 'backward' ? cursor : null,
            query: buildQueryString(),
            sortKey,
            reverse: sortDescending,
          },
        });

        if (errors?.length > 0) {
          setError(errors.map((item: any) => item.message).join(', '));
          return;
        }

        const edges: any[] = data?.orders?.edges ?? [];
        const rows = edges.map((edge: any) => mapOrder(edge.node));
        const nextDrafts: Record<string, Draft> = {};
        const nextFulfillmentTargets: Record<string, string> = {};
        rows.forEach((row) => {
          const savedDraft = savedDraftsRef.current[row.id];
          nextDrafts[row.id] = savedDraft ? savedDraft : draftFromOrder(row);
          if (row.fulfillmentOptions.length > 0) {
            nextFulfillmentTargets[row.id] = row.fulfillmentOptions[0].id;
          }
        });

        setOrders(rows);
        setDrafts(nextDrafts);
        setSelectedFulfillmentIds(nextFulfillmentTargets);
        setSelectedIds([]);
        setPageInfo(
          data?.orders?.pageInfo
            ? {
                hasNextPage: data.orders.pageInfo.hasNextPage === true,
                hasPreviousPage: data.orders.pageInfo.hasPreviousPage === true,
                startCursor: data.orders.pageInfo.startCursor ?? null,
                endCursor: data.orders.pageInfo.endCursor ?? null,
              }
            : null,
        );
      } catch (err: any) {
        setError(err?.message ?? 'تعذر تحميل الطلبات. حاول مرة أخرى.');
      } finally {
        setLoading(false);
      }
    },
    [buildQueryString, pageSize, sortKey, sortDescending],
  );

  useEffect(() => {
    ensureDefinitions();
  }, [ensureDefinitions]);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  useEffect(() => {
    loadLog();
  }, [loadLog]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setActiveSearch(searchInput.trim());
    }, 500);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPageNumber(1);
    fetchOrders(null, 'forward');
  }, [fetchOrders]);

  const updateDraft = (orderId: string, patch: Partial<Draft>): void => {
    setDrafts((current) => {
      const existing = current[orderId];
      if (!existing) return current;
      return { ...current, [orderId]: { ...existing, ...patch } };
    });
  };

  const validateDraft = (order: OrderRow, draft: Draft): string | null => {
    const tracking = draft.tracking.trim();
    if (tracking !== '') {
      if (tracking.indexOf(' ') !== -1) return 'رقم التتبع لا يجوز أن يحتوي مسافات';
      if (tracking.length < MIN_TRACKING_LENGTH) {
        return `رقم التتبع يجب أن يكون ${MIN_TRACKING_LENGTH} خانات على الأقل`;
      }
    }
    if (draft.company.trim().length > MAX_COMPANY_LENGTH) {
      return `اسم شركة الشحن يجب أن يكون ${MAX_COMPANY_LENGTH} حرفًا أو أقل`;
    }
    if (draft.note.length > MAX_NOTE_LENGTH) {
      return `الملاحظة يجب أن تكون ${MAX_NOTE_LENGTH} حرفًا أو أقل`;
    }
    if (
      draft.status !== order.sheetStatus &&
      draft.status !== '' &&
      statusChoices.indexOf(draft.status) === -1
    ) {
      return 'الحالة المختارة غير موجودة في قائمة الحالات';
    }
    if (
      writeToFulfillment &&
      draft.tracking.trim() !== '' &&
      draft.company.trim() === '' &&
      order.fulfillmentCompany === ''
    ) {
      return 'أدخل شركة الشحن مع رقم التتبع قبل الكتابة في التنفيذ الفعلي';
    }
    return null;
  };

  const persistRow = async (order: OrderRow, draft: Draft): Promise<string | null> => {
    if (readOnlyMode) {
      return 'وضع القراءة فقط مُفعّل، أوقفه قبل الحفظ';
    }

    const validationProblem = validateDraft(order, draft);
    if (validationProblem) return validationProblem;

    const updates: Partial<OrderRow> = {};
    const changeList: { field: string; oldValue: string; newValue: string }[] = [];

    if (draft.note !== order.note) {
      const { data, errors } = await shopify.query(ORDER_UPDATE, {
        variables: { input: { id: order.id, note: draft.note } },
      });

      if (errors?.length > 0) {
        return errors.map((item: any) => item.message).join(', ');
      }

      const userErrors = data?.orderUpdate?.userErrors ?? [];
      if (userErrors.length > 0) {
        return joinErrors(userErrors);
      }

      updates.note = data?.orderUpdate?.order?.note ?? draft.note;
      changeList.push({ field: 'note', oldValue: order.note, newValue: draft.note });
    }

    const metafields: any[] = [];

    if (draft.note !== order.note) {
      const history = [...order.notesLog, { text: draft.note, at: new Date().toISOString() }].slice(
        -MAX_NOTES_HISTORY,
      );
      metafields.push({
        ownerId: order.id,
        namespace: NAMESPACE,
        key: NOTES_LOG_KEY,
        type: 'json',
        value: JSON.stringify(history),
      });
      updates.notesLog = history;
    }
    if (draft.status !== order.sheetStatus) {
      metafields.push({
        ownerId: order.id,
        namespace: NAMESPACE,
        key: STATUS_KEY,
        type: 'single_line_text_field',
        value: draft.status,
      });
      changeList.push({ field: 'status', oldValue: order.sheetStatus, newValue: draft.status });
    }
    if (draft.company !== order.shippingCompany) {
      metafields.push({
        ownerId: order.id,
        namespace: NAMESPACE,
        key: COMPANY_KEY,
        type: 'single_line_text_field',
        value: draft.company,
      });
      changeList.push({
        field: 'company',
        oldValue: order.shippingCompany,
        newValue: draft.company,
      });
    }
    if (draft.tracking !== order.manualTracking) {
      metafields.push({
        ownerId: order.id,
        namespace: NAMESPACE,
        key: TRACKING_KEY,
        type: 'single_line_text_field',
        value: draft.tracking,
      });
      changeList.push({
        field: 'tracking',
        oldValue: order.manualTracking,
        newValue: draft.tracking,
      });
    }

    if (metafields.length > 0) {
      const { data, errors } = await shopify.query(METAFIELDS_SET, {
        variables: { metafields },
      });

      if (errors?.length > 0) {
        return errors.map((item: any) => item.message).join(', ');
      }

      const userErrors = data?.metafieldsSet?.userErrors ?? [];
      if (userErrors.length > 0) {
        return joinErrors(userErrors);
      }

      const saved: any[] = data?.metafieldsSet?.metafields ?? [];
      saved.forEach((metafield: any) => {
        if (metafield.key === STATUS_KEY) updates.sheetStatus = metafield.value ?? '';
        if (metafield.key === COMPANY_KEY) updates.shippingCompany = metafield.value ?? '';
        if (metafield.key === TRACKING_KEY) updates.manualTracking = metafield.value ?? '';
      });
      if (draft.status !== order.sheetStatus && updates.sheetStatus === undefined) {
        updates.sheetStatus = draft.status;
      }
      if (draft.company !== order.shippingCompany && updates.shippingCompany === undefined) {
        updates.shippingCompany = draft.company;
      }
      if (draft.tracking !== order.manualTracking && updates.manualTracking === undefined) {
        updates.manualTracking = draft.tracking;
      }
    }

    const trackingChanged: boolean = draft.tracking !== order.manualTracking;
    const companyChanged: boolean = draft.company !== order.shippingCompany;

    const targetFulfillmentId = selectedFulfillmentIds[order.id] || order.fulfillmentId;

    if (writeToFulfillment && targetFulfillmentId && (trackingChanged || companyChanged)) {
      const trackingNumber = draft.tracking || order.fulfillmentTracking;
      const trackingCompany = draft.company || order.fulfillmentCompany;

      const { data, errors } = await shopify.query(FULFILLMENT_TRACKING_UPDATE, {
        variables: {
          fulfillmentId: targetFulfillmentId,
          trackingInfoInput: {
            number: trackingNumber ? trackingNumber : null,
            company: trackingCompany ? trackingCompany : null,
          },
          notifyCustomer,
        },
      });

      if (errors?.length > 0) {
        return errors.map((item: any) => item.message).join(', ');
      }

      const trackingErrors = data?.fulfillmentTrackingInfoUpdate?.userErrors ?? [];
      if (trackingErrors.length > 0) {
        return joinErrors(trackingErrors);
      }

      const savedInfos: any[] =
        data?.fulfillmentTrackingInfoUpdate?.fulfillment?.trackingInfo ?? [];
      updates.fulfillmentTracking = savedInfos[0]?.number ?? '';
      updates.fulfillmentCompany = savedInfos[0]?.company ?? '';
      changeList.push({
        field: 'fulfillment_tracking',
        oldValue: `${order.fulfillmentTracking} / ${order.fulfillmentCompany}`,
        newValue: `${updates.fulfillmentTracking} / ${updates.fulfillmentCompany}`,
      });
    }

    if (Object.keys(updates).length > 0) {
      setOrders((current) =>
        current.map((row) => (row.id === order.id ? { ...row, ...updates } : row)),
      );
    }

    if (changeList.length > 0) {
      await logChanges(order, changeList);
      if (savedDraftsRef.current[order.id]) {
        const remaining = { ...savedDraftsRef.current };
        delete remaining[order.id];
        savedDraftsRef.current = remaining;
        setSavedDraftCount(Object.keys(remaining).length);
      }
    }

    return null;
  };

  const saveRow = async (order: OrderRow): Promise<void> => {
    const draft = drafts[order.id];
    if (!draft || !isDirty(order, draft)) return;

    setSavingIds((current) => [...current, order.id]);
    setError('');
    setSavedMessage('');

    try {
      const failure = await persistRow(order, draft);
      if (failure) {
        setError(`${order.name}: ${failure}`);
      } else {
        setSavedMessage(`تم حفظ التعديلات للطلب ${order.name}`);
      }
    } catch (err: any) {
      setError(`${order.name}: ${err?.message ?? 'تعذر حفظ التعديلات'}`);
    } finally {
      setSavingIds((current) => current.filter((id) => id !== order.id));
      loadLog();
    }
  };

  const saveAll = async (): Promise<void> => {
    const dirtyRows = orders.filter((order) => isDirty(order, drafts[order.id]));
    if (dirtyRows.length === 0) return;

    setSavingAll(true);
    setError('');
    setSavedMessage('');
    const failures: string[] = [];
    let savedCount = 0;

    for (const order of dirtyRows) {
      const draft = drafts[order.id];
      if (!draft) continue;
      try {
        const failure = await persistRow(order, draft);
        if (failure) {
          failures.push(`${order.name}: ${failure}`);
        } else {
          savedCount += 1;
        }
      } catch (err: any) {
        failures.push(`${order.name}: ${err?.message ?? 'تعذر حفظ التعديلات'}`);
      }
    }

    if (failures.length > 0) {
      setError(failures.join(' | '));
    }
    if (savedCount > 0) {
      setSavedMessage(`تم حفظ ${savedCount} من الصفوف`);
    }
    setSavingAll(false);
    loadLog();
  };

  const applyBulk = async (): Promise<void> => {
    if (selectedIds.length === 0) return;

    const hasBulkChange: boolean =
      bulkStatus !== '' || bulkCompany.trim() !== '' || bulkTracking.trim() !== '';
    if (!hasBulkChange) {
      setError('أدخل قيمة واحدة على الأقل للتعديل الجماعي');
      return;
    }

    setBulkSaving(true);
    setError('');
    setSavedMessage('');
    const failures: string[] = [];
    let appliedCount = 0;

    for (const orderId of selectedIds) {
      const order = orders.find((row) => row.id === orderId);
      if (!order) continue;
      const base = drafts[order.id] ?? draftFromOrder(order);
      const merged: Draft = {
        status: bulkStatus === 'clear' ? '' : bulkStatus !== '' ? bulkStatus : base.status,
        company: bulkCompany.trim() !== '' ? bulkCompany : base.company,
        tracking: bulkTracking.trim() !== '' ? bulkTracking : base.tracking,
        note: base.note,
      };

      try {
        const failure = await persistRow(order, merged);
        if (failure) {
          failures.push(`${order.name}: ${failure}`);
        } else {
          appliedCount += 1;
          setDrafts((current) => ({ ...current, [order.id]: merged }));
        }
      } catch (err: any) {
        failures.push(`${order.name}: ${err?.message ?? 'تعذر حفظ التعديلات'}`);
      }
    }

    if (failures.length > 0) {
      setError(failures.join(' | '));
    }
    if (appliedCount > 0) {
      setSavedMessage(`تم تعديل ${appliedCount} من الطلبات المحددة`);
      setBulkStatus('');
      setBulkCompany('');
      setBulkTracking('');
    }
    setBulkSaving(false);
    loadLog();
  };

  const needsFulfillmentConfirm = (order: OrderRow, draft: Draft): boolean => {
    const targetId = selectedFulfillmentIds[order.id] || order.fulfillmentId;
    return (
      writeToFulfillment &&
      targetId !== '' &&
      (draft.tracking !== order.manualTracking || draft.company !== order.shippingCompany)
    );
  };

  const requestSaveRow = (order: OrderRow): void => {
    const draft = drafts[order.id];
    if (!draft || !isDirty(order, draft)) return;

    const validationProblem = validateDraft(order, draft);
    if (validationProblem) {
      setError(`${order.name}: ${validationProblem}`);
      return;
    }

    if (needsFulfillmentConfirm(order, draft)) {
      setPendingConfirm({ kind: 'row', orderId: order.id });
      return;
    }

    saveRow(order);
  };

  const requestSaveAll = (): void => {
    const dirtyRows = orders.filter((order) => isDirty(order, drafts[order.id]));
    if (dirtyRows.length === 0) return;

    for (const order of dirtyRows) {
      const draft = drafts[order.id];
      if (!draft) continue;
      const validationProblem = validateDraft(order, draft);
      if (validationProblem) {
        setError(`${order.name}: ${validationProblem}`);
        return;
      }
    }

    const requiresConfirm = dirtyRows.some((order) =>
      needsFulfillmentConfirm(order, drafts[order.id] ?? draftFromOrder(order)),
    );
    if (requiresConfirm) {
      setPendingConfirm({ kind: 'all', orderId: '' });
      return;
    }

    saveAll();
  };

  const requestApplyBulk = (): void => {
    if (selectedIds.length === 0) return;

    const requiresConfirm =
      writeToFulfillment && (bulkTracking.trim() !== '' || bulkCompany.trim() !== '');
    if (requiresConfirm) {
      setPendingConfirm({ kind: 'bulk', orderId: '' });
      return;
    }

    applyBulk();
  };

  const confirmPendingAction = (): void => {
    const pending = pendingConfirm;
    setPendingConfirm(null);
    if (!pending) return;

    if (pending.kind === 'row') {
      const order = orders.find((row) => row.id === pending.orderId);
      if (order) saveRow(order);
      return;
    }
    if (pending.kind === 'all') {
      saveAll();
      return;
    }
    applyBulk();
  };

  const saveDrafts = async (): Promise<void> => {
    setDraftsSaving(true);
    setError('');
    setSavedMessage('');

    const payload: Record<string, Draft> = { ...savedDraftsRef.current };
    orders.forEach((order) => {
      const draft = drafts[order.id];
      if (draft && isDirty(order, draft)) {
        payload[order.id] = draft;
      } else {
        delete payload[order.id];
      }
    });

    try {
      const definitionProblem = await ensureDraftsDefinition();
      if (definitionProblem) {
        setError(definitionProblem);
        return;
      }

      const { data, errors } = await shopify.query(METAOBJECT_UPSERT, {
        variables: {
          handle: { type: DRAFTS_TYPE, handle: DRAFTS_HANDLE },
          metaobject: { fields: [{ key: 'drafts', value: JSON.stringify(payload) }] },
        },
      });

      if (errors?.length > 0) {
        setError(errors.map((item: any) => item.message).join(', '));
        return;
      }

      const upsertErrors = data?.metaobjectUpsert?.userErrors ?? [];
      if (upsertErrors.length > 0) {
        setError(joinErrors(upsertErrors));
        return;
      }

      savedDraftsRef.current = payload;
      const count = Object.keys(payload).length;
      setSavedDraftCount(count);
      setSavedMessage(`تم حفظ ${count} مسودة لمتابعتها لاحقًا`);
    } catch (err: any) {
      setError(err?.message ?? 'تعذر حفظ المسودات');
    } finally {
      setDraftsSaving(false);
    }
  };

  const resetRowDraft = (order: OrderRow): void => {
    setDrafts((current) => ({ ...current, [order.id]: draftFromOrder(order) }));
  };

  const undoLogEntry = async (entry: LogEntry): Promise<void> => {
    if (readOnlyMode) {
      setError('وضع القراءة فقط مُفعّل، أوقفه قبل التراجع');
      return;
    }
    if (entry.field === 'fulfillment_tracking') {
      setError(
        'لا يمكن التراجع عن تحديث التنفيذ الفعلي من التطبيق؛ عدّله من صفحة الطلب في شوبيفاي',
      );
      return;
    }

    setUndoingId(entry.id);
    setError('');
    setSavedMessage('');

    try {
      if (entry.field === 'note') {
        const { data, errors } = await shopify.query(ORDER_UPDATE, {
          variables: { input: { id: entry.orderId, note: entry.oldValue } },
        });

        if (errors?.length > 0) {
          setError(errors.map((item: any) => item.message).join(', '));
          return;
        }

        const userErrors = data?.orderUpdate?.userErrors ?? [];
        if (userErrors.length > 0) {
          setError(joinErrors(userErrors));
          return;
        }
      } else {
        const keyByField: Record<string, string> = {
          status: STATUS_KEY,
          company: COMPANY_KEY,
          tracking: TRACKING_KEY,
        };
        const metafieldKey = keyByField[entry.field];
        if (!metafieldKey) {
          setError('لا يمكن التراجع عن هذا النوع من التعديلات');
          return;
        }

        const { data, errors } = await shopify.query(METAFIELDS_SET, {
          variables: {
            metafields: [
              {
                ownerId: entry.orderId,
                namespace: NAMESPACE,
                key: metafieldKey,
                type: 'single_line_text_field',
                value: entry.oldValue,
              },
            ],
          },
        });

        if (errors?.length > 0) {
          setError(errors.map((item: any) => item.message).join(', '));
          return;
        }

        const setErrors = data?.metafieldsSet?.userErrors ?? [];
        if (setErrors.length > 0) {
          setError(joinErrors(setErrors));
          return;
        }
      }

      setSavedMessage(
        `تم التراجع عن تعديل ${FIELD_LABELS[entry.field] ?? entry.field} للطلب ${entry.orderName}`,
      );
      await fetchOrders(null, 'forward');
      await loadLog();
    } catch (err: any) {
      setError(err?.message ?? 'تعذر التراجع عن التعديل');
    } finally {
      setUndoingId('');
    }
  };

  const savePreferences = async (): Promise<void> => {
    setPrefsSaving(true);
    setError('');
    setSavedMessage('');

    const settings: SheetPreferences = {
      hiddenColumnIds,
      pinName,
      pinPhone,
      columnCount,
      showAllColumns,
      pageSize,
      sortKey,
      sortDescending,
      statusChoices,
      writeToFulfillment,
      notifyCustomer,
      readOnlyMode,
      lateDays,
    };

    try {
      const definitionProblem = await ensurePrefsDefinition();
      if (definitionProblem) {
        setError(definitionProblem);
        return;
      }

      const { data, errors } = await shopify.query(METAOBJECT_UPSERT, {
        variables: {
          handle: { type: PREFS_TYPE, handle: PREFS_HANDLE },
          metaobject: {
            fields: [{ key: 'settings', value: JSON.stringify(settings) }],
          },
        },
      });

      if (errors?.length > 0) {
        setError(errors.map((item: any) => item.message).join(', '));
        return;
      }

      const upsertErrors = data?.metaobjectUpsert?.userErrors ?? [];
      if (upsertErrors.length > 0) {
        setError(joinErrors(upsertErrors));
        return;
      }

      setPrefsWarning('');
      setSavedMessage('تم حفظ تفضيلات العرض والحالات المخصصة');
    } catch (err: any) {
      setError(err?.message ?? 'تعذر حفظ التفضيلات');
    } finally {
      setPrefsSaving(false);
    }
  };

  const addStatusChoice = (): void => {
    const name = newStatusName.trim();
    if (name === '') {
      setError('اكتب اسم الحالة قبل الإضافة');
      return;
    }
    if (statusChoices.indexOf(name) !== -1) {
      setError('هذه الحالة موجودة بالفعل');
      return;
    }
    setStatusChoices([...statusChoices, name]);
    setNewStatusName('');
    setError('');
  };

  const removeStatusChoice = (name: string): void => {
    setStatusChoices(statusChoices.filter((choice) => choice !== name));
    if (sheetStatusFilter === name) setSheetStatusFilter('');
    if (bulkStatus === name) setBulkStatus('');
  };

  const exportAllResults = async (): Promise<void> => {
    setExporting(true);
    setError('');
    setSavedMessage('');
    setExportUrl('');
    setExportCount(0);
    setExportTruncated(false);

    const collected: OrderRow[] = [];
    let exportCursor: string | null = null;
    let pagesFetched = 0;
    let moreRemaining = false;

    try {
      while (pagesFetched < MAX_EXPORT_PAGES) {
        const { data, errors } = await shopify.query(ORDERS_QUERY, {
          variables: {
            first: EXPORT_PAGE_SIZE,
            after: exportCursor,
            last: null,
            before: null,
            query: buildQueryString(),
            sortKey,
            reverse: sortDescending,
          },
        });

        if (errors?.length > 0) {
          setError(errors.map((item: any) => item.message).join(', '));
          return;
        }

        const edges: any[] = data?.orders?.edges ?? [];
        edges.forEach((edge: any) => collected.push(mapOrder(edge.node)));
        pagesFetched += 1;

        const info = data?.orders?.pageInfo;
        if (!info || info.hasNextPage !== true || !info.endCursor) {
          moreRemaining = false;
          break;
        }
        moreRemaining = true;
        exportCursor = info.endCursor;
      }

      const content = [CSV_HEADERS.map(csvCell).join(','), ...collected.map(orderToCsvRow)].join(
        '\n',
      );
      setExportUrl(`data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${content}`)}`);
      setExportCount(collected.length);
      setExportTruncated(moreRemaining);
    } catch (err: any) {
      setError(err?.message ?? 'تعذر تحضير ملف التصدير');
    } finally {
      setExporting(false);
    }
  };

  const toggleRowSelection = (orderId: string, checked: boolean): void => {
    setSelectedIds((current) =>
      checked
        ? current.indexOf(orderId) === -1
          ? [...current, orderId]
          : current
        : current.filter((id) => id !== orderId),
    );
  };

  const isLateOrder = (order: OrderRow): boolean => {
    if (order.fulfillment === 'FULFILLED') return false;
    const created = new Date(order.createdAt).getTime();
    if (isNaN(created)) return false;
    return Date.now() - created > lateDays * 24 * 60 * 60 * 1000;
  };

  const hasNoPhone = (order: OrderRow): boolean => order.phone.trim() === '';

  const hasNoAddress = (order: OrderRow): boolean =>
    order.address.trim() === '' || order.city.trim() === '';

  const hasNoTracking = (order: OrderRow): boolean =>
    order.fulfillmentTracking === '' && order.manualTracking === '';

  const lateOrders = orders.filter(isLateOrder);
  const noPhoneOrders = orders.filter(hasNoPhone);
  const noAddressOrders = orders.filter(hasNoAddress);
  const noTrackingOrders = orders.filter(hasNoTracking);

  const displayedOrders =
    alertFilter === 'late'
      ? lateOrders
      : alertFilter === 'no-phone'
        ? noPhoneOrders
        : alertFilter === 'no-address'
          ? noAddressOrders
          : alertFilter === 'no-tracking'
            ? noTrackingOrders
            : orders;

  const alertTotal =
    lateOrders.length + noPhoneOrders.length + noAddressOrders.length + noTrackingOrders.length;

  const alertSample = (rows: OrderRow[]): string =>
    rows.length === 0
      ? '—'
      : `${rows
          .slice(0, 5)
          .map((row) => row.name)
          .join('، ')}${rows.length > 5 ? ' …' : ''}`;

  const toggleAllSelection = (checked: boolean): void => {
    setSelectedIds(checked ? displayedOrders.map((order) => order.id) : []);
  };

  const resetFilters = (): void => {
    setFinancialFilter('');
    setFulfillmentFilter('');
    setSheetStatusFilter('');
    setDateFrom('');
    setDateTo('');
    setSearchInput('');
  };

  const handleNextPage = (): void => {
    if (pageInfo?.hasNextPage && pageInfo.endCursor) {
      setPageNumber(pageNumber + 1);
      fetchOrders(pageInfo.endCursor, 'forward');
    }
  };

  const handlePreviousPage = (): void => {
    if (pageInfo?.hasPreviousPage && pageInfo.startCursor) {
      setPageNumber(Math.max(1, pageNumber - 1));
      fetchOrders(pageInfo.startCursor, 'backward');
    }
  };

  const dirtyCount = orders.filter((order) => isDirty(order, drafts[order.id])).length;
  const busy: boolean = loading || savingAll;

  const pageTotalValue = orders.reduce(
    (sum, order) => sum + (isNaN(Number(order.total)) ? 0 : Number(order.total)),
    0,
  );
  const averageOrderValue = orders.length > 0 ? pageTotalValue / orders.length : 0;
  const unfulfilledCount = orders.filter((order) => order.fulfillment !== 'FULFILLED').length;
  const missingStatusCount = orders.filter((order) => order.sheetStatus === '').length;
  const missingTrackingCount = orders.filter(
    (order) => order.fulfillmentTracking === '' && order.manualTracking === '',
  ).length;
  const pendingOrder =
    pendingConfirm && pendingConfirm.kind === 'row'
      ? orders.find((row) => row.id === pendingConfirm.orderId)
      : undefined;

  const pinnedIds: string[] = [];
  if (pinName) pinnedIds.push('name');
  if (pinPhone) pinnedIds.push('phone');
  const pinnedColumns = SCROLL_COLUMNS.filter(
    (column) => pinnedIds.indexOf(column.id) !== -1 && hiddenColumnIds.indexOf(column.id) === -1,
  );
  const windowColumns = SCROLL_COLUMNS.filter(
    (column) => pinnedIds.indexOf(column.id) === -1 && hiddenColumnIds.indexOf(column.id) === -1,
  );

  const maxColumnStart = Math.max(0, windowColumns.length - columnCount);
  const safeColumnStart = Math.min(columnStart, maxColumnStart);
  const visibleColumns = showAllColumns
    ? windowColumns
    : windowColumns.slice(safeColumnStart, safeColumnStart + columnCount);
  const firstVisibleNumber = showAllColumns ? 1 : safeColumnStart + 1;
  const lastVisibleNumber = showAllColumns
    ? windowColumns.length
    : safeColumnStart + visibleColumns.length;
  const allSelected: boolean =
    displayedOrders.length > 0 && selectedIds.length === displayedOrders.length;
  const someSelected: boolean =
    selectedIds.length > 0 && selectedIds.length < displayedOrders.length;

  const csvContent = [CSV_HEADERS.map(csvCell).join(','), ...orders.map(orderToCsvRow)].join('\n');
  const csvUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${csvContent}`)}`;
  const csvName = `orders-page-${pageNumber}.csv`;
  const canShiftStart: boolean = !showAllColumns && safeColumnStart > 0;
  const canShiftEnd: boolean = !showAllColumns && safeColumnStart < maxColumnStart;

  const shiftColumns = (delta: number): void => {
    const nextStart = Math.min(Math.max(0, safeColumnStart + delta), maxColumnStart);
    setColumnStart(nextStart);
  };

  const toggleColumnVisibility = (columnId: string): void => {
    if (!columnId) return;
    setHiddenColumnIds((current) =>
      current.indexOf(columnId) === -1
        ? [...current, columnId]
        : current.filter((id) => id !== columnId),
    );
  };

  const handleJumpToColumn = (columnId: string): void => {
    setJumpColumnId(columnId);
    if (!columnId) return;

    const nextHidden = hiddenColumnIds.filter((id) => id !== columnId);
    setHiddenColumnIds(nextHidden);

    const nextWindowColumns = SCROLL_COLUMNS.filter(
      (column) => pinnedIds.indexOf(column.id) === -1 && nextHidden.indexOf(column.id) === -1,
    );
    const targetIndex = nextWindowColumns.findIndex((column) => column.id === columnId);
    if (targetIndex === -1) return;

    setShowAllColumns(false);
    const nextMaxStart = Math.max(0, nextWindowColumns.length - columnCount);
    setColumnStart(Math.min(targetIndex, nextMaxStart));
  };

  const handleColumnCountChange = (value: string): void => {
    if (value === 'all') {
      setShowAllColumns(true);
      return;
    }
    setShowAllColumns(false);
    setColumnCount(Number(value));
    setColumnStart(0);
  };

  return (
    <s-page id="orders-sheet-page" heading="جدول الطلبات" inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={requestSaveAll}
        loading={savingAll}
        disabled={dirtyCount === 0 || busy || readOnlyMode}
      >
        {dirtyCount > 0 ? `حفظ كل التعديلات (${dirtyCount})` : 'حفظ كل التعديلات'}
      </s-button>
      <s-button slot="secondary-actions" href="shopify://admin/orders">
        فتح صفحة الطلبات
      </s-button>

      {error ? (
        <s-banner id="orders-error-banner" tone="critical" heading="حدث خطأ">
          <s-text>{error}</s-text>
        </s-banner>
      ) : null}

      {setupWarning ? (
        <s-banner id="orders-setup-banner" tone="warning" heading="الحقول المخصصة">
          <s-text>{setupWarning}</s-text>
        </s-banner>
      ) : null}

      {prefsWarning ? (
        <s-banner id="orders-prefs-banner" tone="warning" heading="تفضيلات العرض">
          <s-text>{prefsWarning}</s-text>
        </s-banner>
      ) : null}

      {logWarning ? (
        <s-banner id="orders-log-banner" tone="warning" heading="سجل التعديلات">
          <s-text>{logWarning}</s-text>
        </s-banner>
      ) : null}

      {savedMessage ? (
        <s-banner id="orders-saved-banner" tone="success" heading="تم الحفظ">
          <s-text>{savedMessage}</s-text>
        </s-banner>
      ) : null}

      {readOnlyMode ? (
        <s-banner id="orders-readonly-banner" tone="info" heading="وضع القراءة فقط">
          <s-text>
            التعديل موقوف حاليًا لجميع من يفتح التطبيق. أوقف وضع القراءة فقط من قسم الترتيب والعرض
            لاستئناف التعديل.
          </s-text>
        </s-banner>
      ) : null}

      {pendingConfirm ? (
        <s-banner id="orders-confirm-banner" tone="warning" heading="تأكيد تحديث التنفيذ الفعلي">
          <s-stack gap="small-100">
            <s-text>
              {pendingConfirm.kind === 'row'
                ? `سيتم تحديث رقم التتبع وشركة الشحن على التنفيذ المحدد للطلب ${pendingOrder?.name ?? ''} في شوبيفاي.`
                : pendingConfirm.kind === 'all'
                  ? `سيتم حفظ ${String(dirtyCount)} صفًّا مع تحديث التنفيذ الفعلي في شوبيفاي.`
                  : `سيتم تطبيق التعديل على ${String(selectedIds.length)} طلبًا مع تحديث التنفيذ الفعلي في شوبيفاي.`}
            </s-text>
            <s-text color="subdued">
              {notifyCustomer
                ? 'سيتم إرسال إشعار للعميل بتحديث الشحن.'
                : 'لن يتم إرسال إشعار للعميل.'}
            </s-text>
            <s-stack direction="inline" gap="small-100">
              <s-button
                id="confirm-fulfillment-button"
                variant="primary"
                onClick={confirmPendingAction}
              >
                تأكيد وتحديث
              </s-button>
              <s-button id="cancel-fulfillment-button" onClick={() => setPendingConfirm(null)}>
                إلغاء
              </s-button>
            </s-stack>
          </s-stack>
        </s-banner>
      ) : null}

      <s-section id="summary-section" padding="base">
        <s-heading id="summary-heading">ملخص الصفحة الحالية</s-heading>
        <s-grid
          gridTemplateColumns="@container (inline-size <= 600px) 1fr, 1fr 1fr 1fr"
          gap="small"
        >
          <s-box padding="small-100" borderRadius="base" border="base">
            <s-stack gap="small-300">
              <s-heading>عدد الطلبات</s-heading>
              <s-text>{String(orders.length)}</s-text>
            </s-stack>
          </s-box>
          <s-box padding="small-100" borderRadius="base" border="base">
            <s-stack gap="small-300">
              <s-heading>إجمالي القيمة</s-heading>
              <s-text>{pageTotalValue.toFixed(2)}</s-text>
            </s-stack>
          </s-box>
          <s-box padding="small-100" borderRadius="base" border="base">
            <s-stack gap="small-300">
              <s-heading>متوسط الطلب</s-heading>
              <s-text>{averageOrderValue.toFixed(2)}</s-text>
            </s-stack>
          </s-box>
          <s-box padding="small-100" borderRadius="base" border="base">
            <s-stack gap="small-300">
              <s-heading>غير منفّذ</s-heading>
              <s-text>{String(unfulfilledCount)}</s-text>
            </s-stack>
          </s-box>
          <s-box padding="small-100" borderRadius="base" border="base">
            <s-stack gap="small-300">
              <s-heading>بدون حالة مخصصة</s-heading>
              <s-text>{String(missingStatusCount)}</s-text>
            </s-stack>
          </s-box>
          <s-box padding="small-100" borderRadius="base" border="base">
            <s-stack gap="small-300">
              <s-heading>بدون رقم تتبع</s-heading>
              <s-text>{String(missingTrackingCount)}</s-text>
            </s-stack>
          </s-box>
        </s-grid>
      </s-section>

      <s-section id="alerts-section">
        <s-heading id="alerts-heading">
          تنبيهات داخلية ({String(alertTotal)}) — للصفحة المحمّلة
        </s-heading>
        <s-stack direction="inline" gap="base" alignItems="end">
          <s-select
            id="late-days-select"
            label="اعتبار الطلب متأخرًا بعد (أيام)"
            value={String(lateDays)}
            onChange={(event: any) => setLateDays(Number(event.currentTarget.value))}
          >
            {LATE_DAYS_CHOICES.map((choice) => (
              <s-option key={choice} value={choice}>
                {choice}
              </s-option>
            ))}
          </s-select>
          <s-select
            id="alert-filter-select"
            label="إظهار الطلبات المعنية فقط"
            value={alertFilter}
            onChange={(event: any) => {
              setAlertFilter(event.currentTarget.value);
              setSelectedIds([]);
            }}
          >
            {ALERT_FILTERS.map((choice) => (
              <s-option key={`alert-${choice.value}`} value={choice.value}>
                {choice.label}
              </s-option>
            ))}
          </s-select>
        </s-stack>
        <s-grid gridTemplateColumns="@container (inline-size <= 600px) 1fr, 1fr 1fr" gap="small">
          <s-box padding="small-100" borderRadius="base" border="base">
            <s-stack gap="small-300">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-heading>طلبات متأخرة (أكثر من {String(lateDays)} يوم بلا تنفيذ)</s-heading>
                <s-badge tone={lateOrders.length > 0 ? 'critical' : 'success'}>
                  {String(lateOrders.length)}
                </s-badge>
              </s-stack>
              <s-text color="subdued">{alertSample(lateOrders)}</s-text>
            </s-stack>
          </s-box>
          <s-box padding="small-100" borderRadius="base" border="base">
            <s-stack gap="small-300">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-heading>بدون رقم هاتف</s-heading>
                <s-badge tone={noPhoneOrders.length > 0 ? 'warning' : 'success'}>
                  {String(noPhoneOrders.length)}
                </s-badge>
              </s-stack>
              <s-text color="subdued">{alertSample(noPhoneOrders)}</s-text>
            </s-stack>
          </s-box>
          <s-box padding="small-100" borderRadius="base" border="base">
            <s-stack gap="small-300">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-heading>بدون عنوان أو مدينة</s-heading>
                <s-badge tone={noAddressOrders.length > 0 ? 'warning' : 'success'}>
                  {String(noAddressOrders.length)}
                </s-badge>
              </s-stack>
              <s-text color="subdued">{alertSample(noAddressOrders)}</s-text>
            </s-stack>
          </s-box>
          <s-box padding="small-100" borderRadius="base" border="base">
            <s-stack gap="small-300">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-heading>بدون رقم تتبع</s-heading>
                <s-badge tone={noTrackingOrders.length > 0 ? 'warning' : 'success'}>
                  {String(noTrackingOrders.length)}
                </s-badge>
              </s-stack>
              <s-text color="subdued">{alertSample(noTrackingOrders)}</s-text>
            </s-stack>
          </s-box>
        </s-grid>
        <s-text color="subdued">
          تُحسب التنبيهات من الطلبات المحمّلة في الصفحة الحالية فقط، وتُحدّث مع كل تغيير فلتر أو
          صفحة. حد التأخير يُحفظ مع تفضيلات العرض.
        </s-text>
      </s-section>

      <s-section id="filters-section">
        <s-heading id="filters-heading">تصفية الطلبات</s-heading>
        <s-stack direction="inline" gap="base" alignItems="end">
          <s-select
            id="financial-filter"
            label="حالة الدفع"
            value={financialFilter}
            onChange={(event: any) => setFinancialFilter(event.currentTarget.value)}
          >
            <s-option value="">الكل</s-option>
            {FINANCIAL_FILTERS.map((choice) => (
              <s-option key={choice.value} value={choice.value}>
                {choice.label}
              </s-option>
            ))}
          </s-select>
          <s-select
            id="fulfillment-filter"
            label="حالة التنفيذ"
            value={fulfillmentFilter}
            onChange={(event: any) => setFulfillmentFilter(event.currentTarget.value)}
          >
            <s-option value="">الكل</s-option>
            {FULFILLMENT_FILTERS.map((choice) => (
              <s-option key={choice.value} value={choice.value}>
                {choice.label}
              </s-option>
            ))}
          </s-select>
          <s-select
            id="sheet-status-filter"
            label="الحالة المخصصة"
            value={sheetStatusFilter}
            onChange={(event: any) => setSheetStatusFilter(event.currentTarget.value)}
          >
            <s-option value="">الكل</s-option>
            {statusChoices.map((choice) => (
              <s-option key={choice} value={choice}>
                {choice}
              </s-option>
            ))}
          </s-select>
          <s-date-field
            id="date-from-field"
            label="من تاريخ"
            value={dateFrom}
            onChange={(event: any) => setDateFrom(event.currentTarget.value)}
          />
          <s-date-field
            id="date-to-field"
            label="إلى تاريخ"
            value={dateTo}
            onChange={(event: any) => setDateTo(event.currentTarget.value)}
          />
          <s-button id="reset-filters-button" onClick={resetFilters} disabled={loading}>
            إعادة تعيين الفلاتر
          </s-button>
        </s-stack>
      </s-section>

      <s-section id="display-section">
        <s-heading id="display-heading">الترتيب والعرض والتصدير</s-heading>
        <s-stack direction="inline" gap="base" alignItems="end">
          <s-select
            id="sort-key-select"
            label="ترتيب حسب"
            value={sortKey}
            onChange={(event: any) => setSortKey(event.currentTarget.value)}
          >
            {SORT_CHOICES.map((choice) => (
              <s-option key={choice.value} value={choice.value}>
                {choice.label}
              </s-option>
            ))}
          </s-select>
          <s-select
            id="sort-direction-select"
            label="الاتجاه"
            value={sortDescending ? 'desc' : 'asc'}
            onChange={(event: any) => setSortDescending(event.currentTarget.value === 'desc')}
          >
            <s-option value="desc">تنازلي (الأحدث/الأعلى)</s-option>
            <s-option value="asc">تصاعدي (الأقدم/الأقل)</s-option>
          </s-select>
          <s-select
            id="page-size-select"
            label="عدد الطلبات في الصفحة"
            value={String(pageSize)}
            onChange={(event: any) => setPageSize(Number(event.currentTarget.value))}
          >
            {PAGE_SIZE_CHOICES.map((choice) => (
              <s-option key={choice} value={choice}>
                {choice}
              </s-option>
            ))}
          </s-select>
          <s-checkbox
            id="pin-name-checkbox"
            label="تثبيت عمود الاسم"
            checked={pinName}
            onChange={(event: any) => setPinName(event.currentTarget.checked)}
          />
          <s-checkbox
            id="pin-phone-checkbox"
            label="تثبيت عمود الهاتف"
            checked={pinPhone}
            onChange={(event: any) => setPinPhone(event.currentTarget.checked)}
          />
          <s-checkbox
            id="write-fulfillment-checkbox"
            label="كتابة التتبع في التنفيذ الفعلي"
            details="يُحدّث رقم التتبع وشركة الشحن على أول تنفيذ للطلب عند الحفظ"
            checked={writeToFulfillment}
            onChange={(event: any) => setWriteToFulfillment(event.currentTarget.checked)}
          />
          <s-checkbox
            id="notify-customer-checkbox"
            label="إشعار العميل بالتحديث"
            checked={notifyCustomer}
            disabled={!writeToFulfillment}
            onChange={(event: any) => setNotifyCustomer(event.currentTarget.checked)}
          />
          <s-checkbox
            id="read-only-checkbox"
            label="وضع القراءة فقط"
            details="يقفل كل التعديل داخل التطبيق لكل من يفتحه بعد حفظ التفضيلات"
            checked={readOnlyMode}
            onChange={(event: any) => setReadOnlyMode(event.currentTarget.checked)}
          />
          <s-button
            id="save-drafts-button"
            loading={draftsSaving}
            disabled={draftsSaving || loading}
            onClick={saveDrafts}
          >
            {savedDraftCount > 0
              ? `حفظ المسودات (${String(savedDraftCount)} محفوظة)`
              : 'حفظ المسودات'}
          </s-button>
          <s-link id="csv-export-link" href={csvUrl} download={csvName}>
            تصدير CSV للصفحة الحالية
          </s-link>
          <s-button
            id="export-all-button"
            loading={exporting}
            disabled={exporting || loading}
            onClick={exportAllResults}
          >
            تحضير تصدير كل النتائج
          </s-button>
          {exportUrl ? (
            <s-link id="csv-export-all-link" href={exportUrl} download="orders-all.csv">
              {`تنزيل ملف ${String(exportCount)} طلب${exportTruncated ? ' (وصلنا للحد الأقصى 5000 طلب)' : ''}`}
            </s-link>
          ) : null}
          <s-button
            id="save-prefs-button"
            loading={prefsSaving}
            disabled={prefsSaving}
            onClick={savePreferences}
          >
            حفظ تفضيلات العرض
          </s-button>
        </s-stack>
      </s-section>

      <s-section id="status-section">
        <s-heading id="status-heading">الحالات المخصصة</s-heading>
        <s-stack direction="inline" gap="base" alignItems="end">
          <s-text-field
            id="new-status-field"
            label="إضافة حالة جديدة"
            placeholder="مثال: بانتظار العميل"
            value={newStatusName}
            onInput={(event: any) => setNewStatusName(event.currentTarget.value)}
          />
          <s-button id="add-status-button" onClick={addStatusChoice}>
            إضافة
          </s-button>
        </s-stack>
        <s-stack direction="inline" gap="small-100">
          {statusChoices.map((choice) => (
            <s-button
              key={`status-chip-${choice}`}
              id={`remove-status-${statusChoices.indexOf(choice)}`}
              icon="x"
              accessibilityLabel={`حذف الحالة ${choice}`}
              onClick={() => removeStatusChoice(choice)}
            >
              {choice}
            </s-button>
          ))}
        </s-stack>
        <s-text color="subdued">
          الحالات تُحفظ مع تفضيلات العرض عند الضغط على زر حفظ تفضيلات العرض، وحذف حالة من القائمة لا
          يغير الطلبات المحفوظة بها مسبقًا.
        </s-text>
      </s-section>

      {selectedIds.length > 0 ? (
        <s-section id="bulk-section">
          <s-heading id="bulk-heading">
            تعديل جماعي لـ {String(selectedIds.length)} من الطلبات
          </s-heading>
          <s-stack direction="inline" gap="base" alignItems="end">
            <s-select
              id="bulk-status-select"
              label="الحالة"
              value={bulkStatus}
              onChange={(event: any) => setBulkStatus(event.currentTarget.value)}
            >
              <s-option value="">بدون تغيير</s-option>
              {statusChoices.map((choice) => (
                <s-option key={choice} value={choice}>
                  {choice}
                </s-option>
              ))}
              <s-option value="clear">إزالة الحالة</s-option>
            </s-select>
            <s-text-field
              id="bulk-company-field"
              label="شركة الشحن"
              placeholder="بدون تغيير"
              value={bulkCompany}
              onInput={(event: any) => setBulkCompany(event.currentTarget.value)}
            />
            <s-text-field
              id="bulk-tracking-field"
              label="رقم التتبع"
              placeholder="بدون تغيير"
              value={bulkTracking}
              onInput={(event: any) => setBulkTracking(event.currentTarget.value)}
            />
            <s-button
              id="bulk-apply-button"
              variant="primary"
              loading={bulkSaving}
              disabled={bulkSaving || busy || readOnlyMode}
              onClick={requestApplyBulk}
            >
              تطبيق على المحدد
            </s-button>
            <s-button id="bulk-clear-button" onClick={() => setSelectedIds([])}>
              إلغاء التحديد
            </s-button>
          </s-stack>
        </s-section>
      ) : null}

      <s-section id="orders-table-section" padding="none">
        <s-box padding="base">
          <s-stack gap="small-100">
            <s-stack
              direction="inline"
              gap="small-100"
              justifyContent="space-between"
              alignItems="center"
            >
              <s-heading id="orders-table-heading">الطلبات — الصفحة {String(pageNumber)}</s-heading>
              <s-text color="subdued">
                الأعمدة القابلة للتعديل: الحالة، رقم التتبع، شركة الشحن، الملاحظات
              </s-text>
            </s-stack>
            <s-stack direction="inline" gap="small-100" alignItems="end">
              <s-button
                id="columns-start-button"
                icon="chevron-left"
                accessibilityLabel="الأعمدة السابقة"
                disabled={!canShiftStart}
                onClick={() => shiftColumns(-1)}
              >
                الأعمدة السابقة
              </s-button>
              <s-button
                id="columns-end-button"
                icon="chevron-right"
                accessibilityLabel="الأعمدة التالية"
                disabled={!canShiftEnd}
                onClick={() => shiftColumns(1)}
              >
                الأعمدة التالية
              </s-button>
              <s-select
                id="columns-count-select"
                label="عدد الأعمدة الظاهرة"
                value={showAllColumns ? 'all' : String(columnCount)}
                onChange={(event: any) => handleColumnCountChange(event.currentTarget.value)}
              >
                {COLUMN_COUNT_CHOICES.map((choice) => (
                  <s-option key={choice} value={choice}>
                    {choice}
                  </s-option>
                ))}
                <s-option value="all">كل الأعمدة</s-option>
              </s-select>
              <s-select
                id="jump-column-select"
                label="الانتقال إلى عمود"
                value={jumpColumnId}
                onChange={(event: any) => handleJumpToColumn(event.currentTarget.value)}
              >
                <s-option value="">اختر اسم العمود</s-option>
                {SCROLL_COLUMNS.map((column) => (
                  <s-option key={`jump-${column.id}`} value={column.id}>
                    {column.header}
                  </s-option>
                ))}
              </s-select>
              <s-select
                id="toggle-column-select"
                label="إظهار / إخفاء عمود"
                value=""
                onChange={(event: any) => toggleColumnVisibility(event.currentTarget.value)}
              >
                <s-option value="">اختر اسم العمود</s-option>
                {SCROLL_COLUMNS.map((column) => (
                  <s-option key={`toggle-${column.id}`} value={column.id}>
                    {`${hiddenColumnIds.indexOf(column.id) === -1 ? '☑' : '☐'} ${column.header}`}
                  </s-option>
                ))}
              </s-select>
              <s-button
                id="show-all-columns-button"
                disabled={hiddenColumnIds.length === 0}
                onClick={() => setHiddenColumnIds([])}
              >
                إظهار الأعمدة المخفية
              </s-button>
              <s-text color="subdued">
                يظهر العمود {String(firstVisibleNumber)} إلى {String(lastVisibleNumber)} من{' '}
                {String(windowColumns.length)} (خانة التحديد ورقم الطلب
                {pinnedColumns.length > 0 ? ' والأعمدة المثبتة' : ''} وزر الحفظ ثابتة)
              </s-text>
            </s-stack>
          </s-stack>
        </s-box>

        <s-table
          id="orders-table"
          variant="auto"
          paginate
          loading={loading}
          hasNextPage={pageInfo?.hasNextPage === true}
          hasPreviousPage={pageInfo?.hasPreviousPage === true}
          onNextPage={handleNextPage}
          onPreviousPage={handlePreviousPage}
        >
          <s-search-field
            slot="filters"
            id="orders-search"
            label="بحث في الطلبات"
            placeholder="ابحث برقم الطلب أو البريد أو الاسم أو الهاتف أو المدينة أو رقم التتبع أو شركة الشحن"
            value={searchInput}
            onInput={(event: any) => setSearchInput(event.currentTarget.value)}
          />

          <s-table-header-row id="orders-header-row">
            <s-table-header id="header-select">
              <s-checkbox
                id="select-all-checkbox"
                accessibilityLabel="تحديد كل الطلبات في الصفحة"
                checked={allSelected}
                indeterminate={someSelected}
                disabled={displayedOrders.length === 0 || busy}
                onChange={(event: any) => toggleAllSelection(event.currentTarget.checked)}
              />
            </s-table-header>
            <s-table-header id="header-order" listSlot="primary">
              {ORDER_COLUMN.header}
            </s-table-header>
            {pinnedColumns.map((column) => (
              <s-table-header
                id={`header-pinned-${column.id}`}
                key={`pinned-${column.id}`}
                format={column.format}
                listSlot={column.listSlot}
              >
                {column.header}
              </s-table-header>
            ))}
            {visibleColumns.map((column) => (
              <s-table-header
                id={`header-${column.id}`}
                key={column.id}
                format={column.format}
                listSlot={column.listSlot}
              >
                {column.header}
              </s-table-header>
            ))}
            <s-table-header id="header-actions">حفظ</s-table-header>
          </s-table-header-row>

          <s-table-body id="orders-table-body">
            {displayedOrders.length === 0 && !loading ? (
              <s-table-row id="orders-empty-row">
                <s-table-cell id="orders-empty-cell">
                  <s-text color="subdued">لا توجد طلبات مطابقة</s-text>
                </s-table-cell>
              </s-table-row>
            ) : (
              displayedOrders.map((order) => {
                const shortId = order.id.split('/').pop() ?? order.id;
                const draft = drafts[order.id] ?? draftFromOrder(order);
                const rowDirty: boolean = isDirty(order, draft);
                const rowSaving: boolean = savingIds.indexOf(order.id) !== -1;
                const cellContext: CellContext = {
                  order,
                  draft,
                  shortId,
                  disabled: rowSaving || savingAll || bulkSaving || readOnlyMode,
                  statusChoices,
                  selectedFulfillmentId:
                    selectedFulfillmentIds[order.id] ?? order.fulfillmentOptions[0]?.id ?? '',
                  onChange: (patch: Partial<Draft>) => updateDraft(order.id, patch),
                  onSelectFulfillment: (fulfillmentId: string) =>
                    setSelectedFulfillmentIds((current) => ({
                      ...current,
                      [order.id]: fulfillmentId,
                    })),
                };

                return (
                  <s-table-row id={`order-row-${shortId}`} key={order.id}>
                    <s-table-cell id={`cell-select-${shortId}`}>
                      <s-checkbox
                        id={`select-checkbox-${shortId}`}
                        accessibilityLabel={`تحديد الطلب ${order.name}`}
                        checked={selectedIds.indexOf(order.id) !== -1}
                        disabled={rowSaving || savingAll || bulkSaving}
                        onChange={(event: any) =>
                          toggleRowSelection(order.id, event.currentTarget.checked)
                        }
                      />
                    </s-table-cell>
                    <s-table-cell id={`cell-order-${shortId}`}>
                      {ORDER_COLUMN.render(cellContext)}
                    </s-table-cell>
                    {pinnedColumns.map((column) => (
                      <s-table-cell
                        id={`cell-pinned-${column.id}-${shortId}`}
                        key={`pinned-${column.id}`}
                      >
                        {column.render(cellContext)}
                      </s-table-cell>
                    ))}
                    {visibleColumns.map((column) => (
                      <s-table-cell id={`cell-${column.id}-${shortId}`} key={column.id}>
                        {column.render(cellContext)}
                      </s-table-cell>
                    ))}
                    <s-table-cell id={`cell-actions-${shortId}`}>
                      <s-stack gap="small-300">
                        <s-button
                          id={`save-button-${shortId}`}
                          variant="secondary"
                          loading={rowSaving}
                          disabled={!rowDirty || rowSaving || savingAll || readOnlyMode}
                          onClick={() => requestSaveRow(order)}
                        >
                          حفظ
                        </s-button>
                        <s-button
                          id={`reset-button-${shortId}`}
                          disabled={!rowDirty || rowSaving || savingAll}
                          onClick={() => resetRowDraft(order)}
                        >
                          تراجع
                        </s-button>
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                );
              })
            )}
          </s-table-body>
        </s-table>
      </s-section>

      <s-section id="log-section" padding="none">
        <s-box padding="base">
          <s-stack
            direction="inline"
            gap="small-100"
            justifyContent="space-between"
            alignItems="center"
          >
            <s-heading id="log-heading">سجل التعديلات (أحدث {String(LOG_PAGE_SIZE)})</s-heading>
            <s-button id="refresh-log-button" loading={logLoading} onClick={loadLog}>
              تحديث السجل
            </s-button>
          </s-stack>
        </s-box>
        <s-table id="log-table" variant="auto" loading={logLoading}>
          <s-table-header-row id="log-header-row">
            <s-table-header id="log-header-order" listSlot="primary">
              الطلب
            </s-table-header>
            <s-table-header id="log-header-field">الحقل</s-table-header>
            <s-table-header id="log-header-old">القيمة السابقة</s-table-header>
            <s-table-header id="log-header-new">القيمة الجديدة</s-table-header>
            <s-table-header id="log-header-at">التاريخ</s-table-header>
            <s-table-header id="log-header-action">تراجع</s-table-header>
          </s-table-header-row>
          <s-table-body id="log-table-body">
            {logEntries.length === 0 && !logLoading ? (
              <s-table-row id="log-empty-row">
                <s-table-cell id="log-empty-cell">
                  <s-text color="subdued">لا توجد تعديلات مسجلة بعد</s-text>
                </s-table-cell>
              </s-table-row>
            ) : (
              logEntries.map((entry) => {
                const logShortId = entry.id.split('/').pop() ?? entry.id;
                return (
                  <s-table-row id={`log-row-${logShortId}`} key={entry.id}>
                    <s-table-cell id={`log-cell-order-${logShortId}`}>
                      {textOrDash(entry.orderName)}
                    </s-table-cell>
                    <s-table-cell id={`log-cell-field-${logShortId}`}>
                      {FIELD_LABELS[entry.field] ?? textOrDash(entry.field)}
                    </s-table-cell>
                    <s-table-cell id={`log-cell-old-${logShortId}`}>
                      {textOrDash(entry.oldValue)}
                    </s-table-cell>
                    <s-table-cell id={`log-cell-new-${logShortId}`}>
                      {textOrDash(entry.newValue)}
                    </s-table-cell>
                    <s-table-cell id={`log-cell-at-${logShortId}`}>
                      {formatDate(entry.at)}
                    </s-table-cell>
                    <s-table-cell id={`log-cell-action-${logShortId}`}>
                      <s-button
                        id={`log-undo-${logShortId}`}
                        loading={undoingId === entry.id}
                        disabled={
                          readOnlyMode ||
                          undoingId !== '' ||
                          entry.orderId === '' ||
                          entry.field === 'fulfillment_tracking'
                        }
                        onClick={() => undoLogEntry(entry)}
                      >
                        تراجع
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                );
              })
            )}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}

export default (): void => render(<Extension />, document.body);