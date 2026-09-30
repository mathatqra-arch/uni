# Dead Stock Settings

- Store-wide default: `inventory.deadStockDays` (days, minimum 1, maximum 3650).
- Product override: `products.dead_stock_days_override` (NULL means use the store default).
- Dashboard and General Accounts use the same rule.
- A product with positive stock and no sale inside its effective threshold is considered dead stock.
- No stock quantity is changed by this classification; it is analytics only.
