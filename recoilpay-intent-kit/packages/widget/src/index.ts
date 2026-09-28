import { RecoilPayIntentElement } from './element';

export const TAG = 'recoilpay-intent';

// Loading the script twice (two embeds, or a hot reload) must not throw.
if (!customElements.get(TAG)) customElements.define(TAG, RecoilPayIntentElement);

export { RecoilPayIntentElement };

declare global {
  interface HTMLElementTagNameMap {
    'recoilpay-intent': RecoilPayIntentElement;
  }
}
