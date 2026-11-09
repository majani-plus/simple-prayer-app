/** schema.org FAQPage for a list of visible questions and answers (see ToolFaq.astro). */
export function faqJsonLd(items: readonly { q: string; a: string }[]): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((it) => ({
      '@type': 'Question',
      name: it.q,
      acceptedAnswer: { '@type': 'Answer', text: it.a },
    })),
  };
}
