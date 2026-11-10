/*
 * DocSure — firma embebida.
 * Uso: <script src="https://docsure.app/embed.js" async></script>
 *      <docsure-signing src="URL_DE_FIRMA_DEVUELTA_POR_LA_API"></docsure-signing>
 * Eventos en el elemento: "docsure:loaded", "docsure:signed", "docsure:declined".
 */
(() => {
  if (customElements.get('docsure-signing')) return;

  class DocSureSigning extends HTMLElement {
    connectedCallback() {
      const src = this.getAttribute('src');
      if (!src) return;
      let origin;
      try {
        origin = new URL(src).origin;
      } catch {
        return;
      }
      const iframe = document.createElement('iframe');
      iframe.src = src;
      iframe.title = this.getAttribute('title') || 'Firmar documento';
      iframe.allow = 'clipboard-write';
      iframe.style.cssText = `width:100%;height:${this.getAttribute('height') || '820px'};border:0;display:block;`;
      this.replaceChildren(iframe);
      this.onMessage = (e) => {
        if (e.origin !== origin || e.source !== iframe.contentWindow) return;
        const data = e.data;
        if (!data || data.source !== 'docsure' || typeof data.type !== 'string') return;
        this.dispatchEvent(new CustomEvent(`docsure:${data.type}`, { detail: data, bubbles: true }));
      };
      window.addEventListener('message', this.onMessage);
    }

    disconnectedCallback() {
      if (this.onMessage) window.removeEventListener('message', this.onMessage);
    }
  }

  customElements.define('docsure-signing', DocSureSigning);
})();
