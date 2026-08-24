/**
 * Copy text to the clipboard.
 *
 * navigator.clipboard only exists in secure contexts (https / localhost). This
 * dashboard is normally opened over plain HTTP on the LAN or over ZeroTier, so
 * the async API is usually missing — fall back to the hidden-textarea +
 * execCommand('copy') trick, which still works on http origins.
 *
 * Returns true when the text made it to the clipboard.
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // permission denied / insecure context — fall through to the legacy path
    }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
