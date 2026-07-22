import { NextIntlClientProvider } from 'next-intl';
import { notFound } from 'next/navigation';
import { routing, RTL_LOCALES } from '@/i18n/routing';
import { getMessages } from 'next-intl/server';
import { InstallPrompt } from '@/components/InstallPrompt';

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!(routing.locales as readonly string[]).includes(locale)) notFound();

  const messages = await getMessages();
  const dir = RTL_LOCALES.has(locale) ? 'rtl' : 'ltr';

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <div lang={locale} dir={dir} className="contents">
        {children}
        <InstallPrompt />
      </div>
    </NextIntlClientProvider>
  );
}
