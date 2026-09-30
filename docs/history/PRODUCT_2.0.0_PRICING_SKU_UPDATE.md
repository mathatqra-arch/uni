# Product pricing + SKU update

- Product UI now uses one field: سعر الشراء / الجملة.
- Backend keeps purchase_cost and wholesale_price synchronized for compatibility.
- Category-aware SKU generation: CATEGORY[-SUBCATEGORY]-NNNN.
- Categories receive stable unique 3-character SKU codes.
- Product creation requires a category; uncategorized products are blocked.
- Existing manual SKUs are preserved on edit.
