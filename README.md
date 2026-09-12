# KSV Orders Sheet Manager DRM

Internal Shopify embedded order-management app for KSV beauty.

## Current foundation

- Shopify app client ID: `497781ec8fd2691747d174ff4dccde05`
- Shopify Admin API: `2026-07`
- OAuth installation flow with HMAC/state validation
- Order search by Shopify query syntax
- Orders spreadsheet-style table
- Customer, payment, fulfillment, address, tracking and line-item visibility
- Health endpoint at `/health`

## Required environment

Set `SHOPIFY_API_SECRET` and the deployed `APP_URL` in the hosting environment. Never commit the API secret.

The `application_url` and OAuth callback in `shopify.app.toml` must match the final deployed URL before production deployment.

## Next implementation stage

1. Persist sessions instead of process memory.
2. Add inline order/customer editing with explicit mutation permissions.
3. Add pagination and bulk actions.
4. Add manual tracking/shipping overrides.
5. Add KSV operational tags/notes workflows.
6. Add production CI/CD deployment.
