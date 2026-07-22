import { NextIntlClientProvider } from 'next-intl';

/**
 * Layout for the non-locale-prefixed (app) route group.
 * Provides NextIntlClientProvider with the default locale so that
 * components using useTranslations work during prerendering.
 */
export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  // Load messages directly to avoid dependency on request-scoped locale context,
  // which isn't available for statically prerendered pages in this route group.
  const messages = (await import('@/messages/en.json')).default;

  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
