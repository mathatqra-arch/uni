# Partial Return Reporting Fix

Partial returns are now propagated through all sales-related reports in both Web and Desktop report paths.

- Sales report: net subtotal/tax/total per invoice and in summaries.
- Profit report: returned quantities are removed from sold quantities, revenue, tax and cost. Fully returned lines disappear.
- Product report: returned quantities are removed; a product with no remaining sold quantity disappears from the report.
- Customer report: customer revenue is net of completed returns.
- Tax report: invoice-level and item-level tax are reduced by returned portions.
- Returns report: remains the source of truth for refund transactions and returned products.
- Cash report: refund cash movements remain counted as cash outflow.
- Dashboard: existing net-return handling remains intact.
- CSV/print views: use net values for sales and tax reports.

Inventory is not artificially reduced by a return: the refund workflow already restores returned quantities to stock, so current inventory remains correct.
