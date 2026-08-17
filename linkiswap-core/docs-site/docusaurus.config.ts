import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { themes as prismThemes } from 'prism-react-renderer';

const config: Config = {
  title: 'LinkiSwap Docs',
  tagline: 'Cross-chain swaps in plain English.',
  favicon: 'img/favicon.svg',

  // Set to the public URL once you have one; safe defaults for local + Render preview.
  url: 'https://docs.linkiswap.app',
  baseUrl: '/',

  organizationName: 'linkiswap',
  projectName: 'linkiswap-docs',

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
            'https://github.com/linkiswap/linkiswap-core/edit/main/docs-site/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/logo.svg',
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'LinkiSwap',
      logo: {
        alt: 'LinkiSwap',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'userGuide',
          position: 'left',
          label: 'User Guide',
        },
        {
          href: 'https://linkiswap.app',
          label: 'Open the app',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Product',
          items: [
            { label: 'Open the app', href: 'https://linkiswap.app' },
            { label: 'Quickstart', to: '/quickstart' },
            { label: 'Writing intents', to: '/writing-intents' },
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
      copyright: `Copyright © ${new Date().getFullYear()} LinkiSwap. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
