import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { subscriptions } from '../subscribe/route';

export async function POST(req: NextRequest) {
  const vapidEmail = process.env.VAPID_EMAIL;
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;

  if (!vapidEmail || !vapidPublic || !vapidPrivate) {
    return NextResponse.json({ ok: false, error: 'VAPID env vars not set' }, { status: 500 });
  }

  webpush.setVapidDetails(`mailto:${vapidEmail}`, vapidPublic, vapidPrivate);

  const { title, body, url } = await req.json();
  const payload = JSON.stringify({ title, body, url });
  let sent = 0;

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub as unknown as webpush.PushSubscription, payload);
      sent++;
    } catch {
      subscriptions.delete(sub);
    }
  }

  return NextResponse.json({ ok: true, sent });
}
