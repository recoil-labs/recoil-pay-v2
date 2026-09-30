import type { IntentExample, RecoilTheme } from '@recoilpay/intent-react';
import componentCss from '@recoilpay/intent-react/styles.css';
import { createRoot, type Root } from 'react-dom/client';
import type { EIP1193Provider } from 'viem';
import widgetCss from './widget.css';
import { WidgetApp, type WidgetConfig } from './WidgetApp';

const ATTRIBUTES = [
  'api-url',
  'hf-access-token',
  'walletconnect-project-id',
  'mode',
  'accent',
  'accent-text',
  'radius',
  'font-family',
  'placeholder',
  'examples',
] as const;

/**
 * `<recoilpay-intent>`: the whole RecoilPay intent flow as one element.
 * Renders into a shadow root, so the host page's CSS can't reach in and the
 * widget's can't leak out. Configure with attributes; listen for
 * `recoilpay-*` events for results.
 */
export class RecoilPayIntentElement extends HTMLElement {
  static observedAttributes = [...ATTRIBUTES];

  #root: Root | null = null;
  #provider: EIP1193Provider | null = null;
  #examples: IntentExample[] | false | undefined;

  /** A wallet the page already connected (e.g. `window.ethereum`). Skips the picker. */
  get provider(): EIP1193Provider | null {
    return this.#provider;
  }
  set provider(value: EIP1193Provider | null) {
    this.#provider = value;
    this.#render();
  }

  /** Suggestions under the field; `false` hides them. Also settable as a JSON `examples` attribute. */
  get examples(): IntentExample[] | false | undefined {
    return this.#examples;
  }
  set examples(value: IntentExample[] | false | undefined) {
    this.#examples = value;
    this.#render();
  }

  connectedCallback() {
    if (!this.#root) {
      const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
      const mount = document.createElement('div');
      shadow.replaceChildren(...styleNodes(shadow), mount);
      this.#root = createRoot(mount);
    }
    this.#render();
  }

  disconnectedCallback() {
    // Unmount on the next tick: a node moved within the page fires
    // disconnected and then connected again, and shouldn't lose its state.
    queueMicrotask(() => {
      if (!this.isConnected && this.#root) {
        this.#root.unmount();
        this.#root = null;
      }
    });
  }

  attributeChangedCallback() {
    this.#render();
  }

  #config(): WidgetConfig {
    const attr = (name: (typeof ATTRIBUTES)[number]) => this.getAttribute(name) ?? undefined;
    const radius = attr('radius');
    const theme: RecoilTheme = {
      mode: attr('mode') === 'light' ? 'light' : 'dark',
      accent: attr('accent'),
      accentText: attr('accent-text'),
      radius: radius !== undefined && !Number.isNaN(Number(radius)) ? Number(radius) : undefined,
      fontFamily: attr('font-family'),
    };
    return {
      apiUrl: attr('api-url'),
      hfAccessToken: attr('hf-access-token') ?? null,
      walletConnectProjectId: attr('walletconnect-project-id'),
      theme,
      placeholder: attr('placeholder'),
      examples: this.#examples ?? parseExamples(attr('examples')),
      hostProvider: this.#provider,
    };
  }

  #emit = (name: string, detail: unknown) => {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  };

  #render() {
    this.#root?.render(<WidgetApp config={this.#config()} emit={this.#emit} />);
  }
}

const CSS = `${componentCss}\n${widgetCss}`;
let sharedSheet: CSSStyleSheet | null = null;

/**
 * Styles for the shadow root. Constructed stylesheets are preferred: they
 * aren't subject to CSP `style-src`, so hosts with a strict policy don't need
 * 'unsafe-inline', and one sheet is shared by every widget on the page.
 * Browsers without them get a <style> element instead.
 */
function styleNodes(shadow: ShadowRoot): Node[] {
  try {
    if (!sharedSheet) {
      sharedSheet = new CSSStyleSheet();
      sharedSheet.replaceSync(CSS);
    }
    shadow.adoptedStyleSheets = [sharedSheet];
    return [];
  } catch {
    const style = document.createElement('style');
    style.textContent = CSS;
    return [style];
  }
}

function parseExamples(raw: string | undefined): IntentExample[] | false | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'false' || raw === 'none') return false;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((e) => typeof e?.label === 'string' && typeof e?.sentence === 'string') : undefined;
  } catch {
    console.warn('<recoilpay-intent>: `examples` must be JSON like [{"label":"…","sentence":"…"}]');
    return undefined;
  }
}
