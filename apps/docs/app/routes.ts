import { index, route, type RouteConfig } from '@react-router/dev/routes';

export default [
  route('api/search', 'routes/search.ts'),

  // LLM integration:
  route('llms.txt', 'llms/index.ts'),
  route('llms-full.txt', 'llms/full.ts'),
  route('llms.mdx/*', 'llms/mdx.ts'),

  // The home page is docs/index.md; the splat route does not match `/` when prerendering.
  index('routes/docs.tsx', { id: 'home' }),
  // Every page, at the root of the site. Unknown paths 404 inside the docs layout.
  route('*', 'routes/docs.tsx'),
] satisfies RouteConfig;
