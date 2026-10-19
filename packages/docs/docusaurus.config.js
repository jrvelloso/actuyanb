// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion

const { themes } = require('prism-react-renderer');

const defaultOptions = {
  editUrl: 'https://github.com/jrvelloso/actuyanb/tree/master/packages/docs',
  beforeDefaultRemarkPlugins: [
    require('./src/remark/mentions'),
    require('./src/remark/enforce-doc-links'),
  ],
};

/** @type {import('@docusaurus/types').Config} */
module.exports = {
  title: 'ActuYNAB',
  tagline: 'Your finances - made simple',
  url: process.env.ACTUYNAB_DOCS_URL ?? 'https://jrvelloso.github.io',
  baseUrl: process.env.ACTUYNAB_DOCS_BASE_URL ?? '/actuyanb/',
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  favicon: 'img/favicon.ico',

  projectName: 'actuyanb',
  organizationName: 'jrvelloso',
  deploymentBranch: 'main',

  // Even if you don't use internalization, you can use this field to set useful
  // metadata like html lang. For example, if your site is Chinese, you may want
  // to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  themes: ['@docusaurus/theme-mermaid'],

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: 'docs',
          sidebarPath: require.resolve('./docs-sidebar.js'),
          ...defaultOptions,
        },
        blog: {
          ...defaultOptions,
          blogSidebarTitle: 'All posts',
          blogSidebarCount: 'ALL',
          feedOptions: {
            type: 'rss',
            title: 'Actual Budget upstream news',
            description:
              'Read news retained from the Actual Budget upstream project',
            copyright: `Copyright © ${new Date().getFullYear()} ActuYNAB. All rights reserved.`,
          },
          onUntruncatedBlogPosts: 'ignore',
        },
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],
  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/og.webp',
      navbar: {
        title: 'ActuYNAB',
        logo: {
          alt: 'ActuYNAB',
          src: 'img/logo.webp',
        },
        items: [
          {
            to: '/#features',
            // never render as active
            activeBaseRegex: '^$',
            label: 'Features',
            position: 'left',
          },
          {
            type: 'docSidebar',
            sidebarId: 'tourSidebar',
            label: 'Tour',
            position: 'left',
          },
          {
            type: 'doc',
            docId: 'index',
            label: 'Docs',
            position: 'left',
          },
          {
            to: 'blog',
            label: 'Upstream news',
            position: 'left',
          },
          {
            type: 'docSidebar',
            sidebarId: 'communitySidebar',
            label: 'Upstream community',
            position: 'left',
          },
          {
            to: '/download',
            label: 'Download',
            position: 'left',
          },
          {
            href: 'https://discord.gg/8JfAXSgfRf',
            label: 'Actual Budget Discord',
            position: 'right',
          },
          {
            href: 'https://github.com/jrvelloso/actuyanb',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            label: 'Actual Budget Discord',
            href: 'https://discord.gg/8JfAXSgfRf',
          },
          {
            label: 'GitHub',
            href: 'https://github.com/jrvelloso/actuyanb',
          },
          {
            label: 'Website Source',
            href: 'https://github.com/jrvelloso/actuyanb/tree/master/packages/docs',
          },
          {
            label: 'Privacy Policy',
            to: '/docs/privacy-policy',
          },
          {
            label: 'RSS Feed',
            href: 'https://actualbudget.org/blog/rss.xml',
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} ActuYNAB. Built with Docusaurus.`,
      },
      prism: {
        theme: themes.github,
        darkTheme: themes.dracula,
        additionalLanguages: ['nginx'],
      },

      colorMode: {
        defaultMode: 'light',
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },

      zoom: {
        // See: https://github.com/timmywil/panzoom for available options
        disableZoom: true,
        // A list of selectors to look for elements to enable pan and zoom
        selectors: [
          'div.mermaid[data-processed="true"]:not(.panzoom-exclude *)',
          'div.docusaurus-mermaid-container:not(.panzoom-exclude *)',
          '.drawio',
          '.panzoom-example',
        ],

        // Whether to wrap the panzoom items in a div with overflow:hidden
        // This constrains the pan zoom detail into the original container
        wrap: true,

        // The amount of time to wait in MS before the plugin client module tries to look for
        // and alter pan zoom elements. Some renders take a little bit before they appear in the
        // dom to find.
        timeout: 2000,
        excludeClass: 'panzoom-exclude',

        toolbar: {
          enabled: true,
        },
      },
    }),
  plugins: [
    [
      '@docusaurus/plugin-client-redirects',
      {
        redirects: [
          {
            from: '/contact',
            to: '/docs/community/',
          },
          {
            from: '/docs/actual-server-repo-move',
            to: '/docs/install/',
          },
        ],
      },
    ],
    [
      '@docusaurus/plugin-ideal-image',
      {
        quality: 70,
        max: 1030, // max resized image's size.
        min: 640, // min resized image's size. if original is lower, use that size.
        steps: 2, // the max number of images generated between min and max (inclusive)
        disableInDev: false,
      },
    ],
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      /** @type {import("@easyops-cn/docusaurus-search-local").PluginOptions} */
      ({
        hashed: true,
        indexDocs: true,
        indexPages: false,
        language: 'en',
      }),
    ],
    '@r74tech/docusaurus-plugin-panzoom',
  ],
};
