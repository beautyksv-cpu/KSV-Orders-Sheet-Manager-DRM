# KSV Orders Sheet Manager DRM

Shopify-hosted custom Admin app for KSV beauty's internal order operations. The app runs **directly inside Shopify Admin** and does not require Render, Cloud Run, Express, Google Sheets, a database provider, or a separate OAuth server.

## Architecture

This project uses Shopify's **Admin App Home UI extension** model with the `admin.app.home.render` target. Shopify hosts the interface and exposes `shopify.query()` for authenticated GraphQL Admin API access. Operational data is stored in Shopify order metafields and Shopify metaobjects owned by the shop.

## Implemented features

- Shopify-hosted App Home UI extension
- Preact + Shopify UI extension components
- Live Orders GraphQL query with cursor pagination in both directions
- Search using Shopify order query syntax
- Financial-status, fulfillment-status, custom-status, date, and alert filters
- Configurable sorting and page sizes
- Customer, contact, address, city, order details, totals, discounts, payment gateways, fulfillment status, and tracking
- Custom operational status, manual tracking number, and manual shipping company
- Native Shopify order-note editing
- Optional write-back of tracking information to a selected fulfillment, with customer-notification control
- Row-level save, save all changes, draft save/restore, and read-only mode
- Bulk editing for selected orders
- Full filtered CSV export with a bounded page limit
- Loaded-page operational metrics and missing-data alerts
- Column visibility, column windowing, pinned columns, and display preferences
- Custom status-list management
- Notes history stored in Shopify order metafields
- Audit log and undo for supported order-note/metafield changes

## Shopify-owned storage

The app uses the `sidekick` namespace for order metafields:

- `sheet_status`
- `shipping_company`
- `tracking_number_manual`
- `notes_log` (JSON)

Shop-level preferences, drafts, and audit entries are stored as Shopify metaobjects using these types:

- `sidekick_orders_sheet_prefs`
- `sidekick_orders_sheet_drafts`
- `sidekick_orders_sheet_log`

The app creates the required metafield and metaobject definitions on first use when the current Shopify Admin permissions allow it.

## Permissions

Required:

- `read_orders`
- `write_orders`
- `read_customers`

Optional:

- `read_all_orders` — requires Shopify approval before it can be used for orders older than the default 60-day window.

No access token, API secret, external service URL, or external database credential is stored in frontend source code.

## Development and deployment

Use the current Shopify CLI. For a Shopify-hosted App Home extension, the repository should be run and deployed through Shopify CLI rather than a separate web server.

Typical flow:

1. Link the repository to the Shopify app with the Shopify CLI.
2. Run the app against the KSV development store.
3. Verify that Orders Sheet loads real orders in Shopify Admin.
4. Verify edits, bulk actions, fulfillment tracking, preferences, drafts, audit/undo, and CSV export.
5. Deploy the app version with Shopify CLI, or use the GitHub Actions workflow on `main`.

The GitHub Actions deployment expects `SHOPIFY_APP_AUTOMATION_TOKEN` as a repository secret. No external runtime provider is required.

## Local verification

From `extensions/app-home`:

```bash
npm install
npm test
npx --yes esbuild src/AppHome.tsx --bundle --format=esm --external:@shopify/ui-extensions/preact --outfile=/tmp/ksv-orders-app-home.js
```

The esbuild command is a syntax/bundle smoke test; the Shopify CLI remains the source of truth for extension validation and deployment.

## Current boundaries

The app uses Shopify Admin permissions as its access-control boundary; it does not implement separate per-staff roles. Shopify's normal Admin and app-distribution approval rules still apply. The CSV export is intentionally bounded to a maximum number of pages to avoid excessive Admin API calls. Undo is supported for order notes and the app-owned metafields; fulfillment tracking changes should be corrected from the order page when an external fulfillment system controls them.

Do not add Render/Cloud Run environment variables or OAuth callback URLs unless the architecture is intentionally changed back to a developer-hosted iframe app.
