// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://d15fvxnndct814.cloudfront.net',
	integrations: [
		starlight({
			title: 'Directus Docs',
			description: 'Directus Documentation — AI-optimized by PerseveranceAI',
			components: {
				Head: './src/components/Head.astro',
			},
			customCss: ['./src/styles/directus-tokens.css'],
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/directus/directus' },
			],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Overview', slug: 'getting-started/overview' },
						{ label: 'Use the API', slug: 'getting-started/use-the-api' },
					],
				},
				{
					label: 'Guides',
					items: [
						{
							label: 'Auth',
							items: [
								{ label: 'Access Tokens', slug: 'guides/auth/tokens-cookies' },
							],
						},
						{
							label: 'Connect',
							items: [
								{ label: 'Directus SDK', slug: 'guides/connect/sdk' },
							],
						},
						{
							label: 'Extensions',
							items: [
								{ label: 'Extensions Overview', slug: 'guides/extensions/overview' },
							],
						},
					],
				},
			],
			head: [
				{
					tag: 'meta',
					attrs: { property: 'og:image', content: 'https://directus.io/og-image.png' },
				},
				{
					tag: 'link',
					attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
				},
				{
					tag: 'link',
					attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: true },
				},
				{
					tag: 'link',
					attrs: {
						rel: 'stylesheet',
						href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@500;600;700&display=swap',
					},
				},
			],
		}),
	],
});
