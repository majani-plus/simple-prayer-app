import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Articles, English-only, at /blog/<filename>. `date` stays a 'YYYY-MM-DD' string so the
 * frontmatter reads the same everywhere it is pasted (dev.to cross-posts included).
 * `canonical` is only for an article first published elsewhere; by default each page is its own
 * canonical, so cross-posts can point back here.
 */
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
    tags: z.array(z.string()).optional(),
    /** Reading order among articles published on the same day; lower comes first. */
    order: z.number().int().optional(),
    canonical: z.string().url().optional(),
  }),
});

export const collections = { blog };
