import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { themes as prismThemes } from 'prism-react-renderer';

const config: Config = {
  title: 'RecoilPay Docs',
  tagline: 'Cross-chain swaps in plain English.',
  favicon: 'img/favicon.png',

  // Set to the public URL once you have one; safe defaults for local + Render preview.
  url: 'https://docs.recoilpay.com',
  baseUrl: '/',

  organizationName: 'recoilpay',
  projectName: 'recoilpay-docs',

  onBrokenLinks: 'warn',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/',
          editUrl:
            'https://github.com/recoil-labs/recoil-pay-v2/edit/main/recoil-core/docs-site/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/og-image.png',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'RecoilPay',
      logo: {
        alt: 'RecoilPay',
        src: 'img/logo.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'userGuide',
          position: 'left',
          label: 'User Guide',
        },
        {
          type: 'docSidebar',
          sidebarId: 'developers',
          position: 'left',
          label: 'Developers',
        },
        // Swagger UI served by the aggregator itself (the `openapi` cargo
        // feature). Declared before "Open the app" so the product CTA stays
        // the rightmost item — Docusaurus lays right-positioned items out in
        // declaration order.
        {
          href: 'https://api.recoilpay.com/swagger-ui',
          label: 'Interactive API Reference',
          position: 'right',
          className: 'navbar-api-cta',
        },
        {
          href: 'https://v2.recoilpay.com',
          label: 'Open the app',
          position: 'right',
          className: 'navbar-app-cta',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Product',
          items: [
            { label: 'Open the app', href: 'https://v2.recoilpay.com' },
            { label: 'Quickstart', to: '/quickstart' },
            { label: 'Writing intents', to: '/writing-intents' },
          ],
        },
        {
          title: 'Developers',
          items: [
            { label: 'Integrate RecoilPay', to: '/integrate/' },
            { label: 'Forward your first intent', to: '/integrate/quickstart' },
            { label: 'API reference', to: '/integrate/api-reference' },
            {
              label: 'API playground',
              href: 'https://api.recoilpay.com/swagger-ui',
            },
            { label: 'Run a solver', href: 'https://solver.recoilpay.com' },
          ],
        },
        {
          title: 'Help',
          items: [
            { label: 'FAQ', to: '/faq' },
            { label: 'Troubleshooting', to: '/troubleshooting' },
            { label: 'Supported networks', to: '/supported-networks' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} RecoilPay. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
