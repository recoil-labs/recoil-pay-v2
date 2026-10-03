import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  userGuide: [
    'intro',
    'quickstart',
    'writing-intents',
    'supported-networks',
    'wallet-setup',
    'fees-and-timing',
    'operators',
    'faq',
    'troubleshooting',
  ],

  // Developer + partner integration guide. Separate sidebar (and its own navbar
  // item) so the user guide stays free of HTTP and EIP-712: the two audiences
  // share almost no pages, and mixing them makes both harder to read.
  developers: [
    'integrate/index',
    'integrate/quickstart',
    'integrate/intents',
    'integrate/signing',
    'integrate/api-reference',
    {
      type: 'category',
      label: 'Drop-in UI',
      link: { type: 'doc', id: 'integrate/drop-in-ui' },
      items: ['integrate/widget', 'integrate/react', 'integrate/sdk'],
    },
    'integrate/going-live',
  ],
};

export default sidebars;
