import { useEffect, useState } from 'react'

// ============================================================
// useDebounce — delay updating a value until the user stops typing
// ============================================================
// Previously this exact 4-line pattern was duplicated across 7
// modules (products, customers, sales, suppliers, inventory,
// purchases, expenses). Each had its own setTimeout/clearTimeout
// with slightly different delays (300ms, 350ms, 400ms).
//
// Now all modules use this single hook, ensuring consistent
// debounce behavior and making it easy to tune the delay globally.
//
// Usage:
//   const [search, setSearch] = useState('')
//   const debouncedSearch = useDebounce(search, 350)
//   useEffect(() => { loadProducts() }, [debouncedSearch])
// ============================================================

export function useDebounce<T>(value: T, delayMs: number = 350): T {
  const [debounced, setDebounced] = useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}

// ============================================================
// useDebouncedCallback — delay calling a function until the
// user stops triggering it. Useful for triggering a search
// API call when the user types, without needing a separate
// useEffect.
// ============================================================
// Usage:
//   const debouncedSearch = useDebouncedCallback((q: string) => {
//     loadProducts(q)
//   }, 350)
//   <input onChange={e => debouncedSearch(e.target.value)} />
// ============================================================

export function useDebouncedCallback<T extends (...args: never[]) => void>(
  callback: T,
  delayMs: number = 350
): (...args: Parameters<T>) => void {
  const [timer, setTimer] = useState<NodeJS.Timeout | null>(null)

  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    const newTimer = setTimeout(() => callback(...args), delayMs)
    setTimer(newTimer)
  }
}
