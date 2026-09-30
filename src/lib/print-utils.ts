/**
 * Print trusted/generated HTML without opening a second window and injecting
 * markup through document.write. The caller must still HTML-escape dynamic data.
 */
export function printHtmlDocument(html: string, delayMs = 250): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.title = 'نافذة الطباعة'
  frame.style.position = 'fixed'
  frame.style.width = '1px'
  frame.style.height = '1px'
  frame.style.border = '0'
  frame.style.opacity = '0'
  frame.style.pointerEvents = 'none'
  frame.style.inset = '0'
  frame.onload = () => {
    window.setTimeout(() => {
      try {
        frame.contentWindow?.focus()
        frame.contentWindow?.print()
      } finally {
        window.setTimeout(() => frame.remove(), 10000)
      }
    }, delayMs)
  }
  document.body.appendChild(frame)
  frame.srcdoc = html
}
