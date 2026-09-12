# KSV Orders Sheet Manager DRM

Shopify-hosted custom Admin app for KSV beauty's internal order operations.

## Architecture

This project uses Shopify's **App Home UI extension** model with the `admin.app.home.render` target. The primary Orders Sheet UI is hosted by Shopify; there is no Render, Cloud Run, Express server, or custom OAuth server in this implementation.

Shopify's App Home UI extension model is intended for custom-distribution apps and provides the `shopify.query()` API for authenticated GraphQL Admin API access.

## Current implementation

- Shopify app client ID: `497781ec8fd2691747d174ff4dccde05`
- Admin API version: `2026-07`
- Shopify-hosted App Home UI extension
- Preact + Shopify UI extension components
- Live Orders GraphQL query
- Cursor pagination
- Page sizes: 25 / 50 / 100 / 250
- Search using Shopify order query syntax
- Customer/contact/address/city/order details
- Payment gateway names and financial status
- Fulfillment status and tracking
- Custom operational status
- Manual tracking number
- Manual shipping company
- Native order note editing
- Row-level save
- Save all changes
- Read-only mode
- UTF-8 BOM CSV export for the currently loaded page
- Loaded-page operational metrics

## Editable operational data

Order metafields use the `sidekick` namespace:

- `sheet_status`
- `shipping_company`
- `tracking_number_manual`

Native Shopify order notes are updated through `orderUpdate`.

## Permissions

Required:

- `read_orders`
- `write_orders`
- `read_customers`

Optional:

- `read_all_orders` — requires Shopify approval before it can be used for orders older than the default 60-day window.

No access token or API secret is stored in frontend source code.

## Known limitations in this phase

- Full Google Sheets clipboard/range/drag-fill behavior is not claimed.
- Bulk editing UI is staged for the next implementation phase.
- Real fulfillment tracking write-back with confirmation is staged for the next phase.
- CSV export currently exports the loaded page; a full filtered export requires iterating through all cursors.
- Alerts, preferences, drafts, notes history, and audit/undo storage are staged for the next phase.
- Per-staff permissions are not claimed; Shopify Admin permissions remain the primary access control.

## Development

Use the current Shopify CLI. For a Shopify-hosted App Home extension, the repository should be run and deployed through Shopify CLI rather than a separate web server.

Typical flow:

1. Link this repository to the Shopify app with the Shopify CLI.
2. Run the app against the KSV development store.
3. Verify the Orders Sheet loads real orders in Shopify Admin.
4. Deploy the app version with Shopify CLI.

Do not add Render/Cloud Run environment variables or OAuth callback URLs unless the architecture is intentionally changed back to a developer-hosted iframe app.
