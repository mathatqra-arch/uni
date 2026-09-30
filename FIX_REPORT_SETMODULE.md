# Uni Kasher 2.0.9 — Runtime Error Fix

## Fixed
`src/desktop/desktop-app.tsx` referenced `setModule` in the F2 keyboard handler and its effect dependency array, but the hook destructuring only read `activeModule` and `theme`.

Changed:
`const { activeModule, theme } = useUIStore()`
→
`const { activeModule, setModule, theme } = useUIStore()`

This restores the missing binding without changing business logic, navigation semantics, API behavior, SQLite, licensing, or permissions.
