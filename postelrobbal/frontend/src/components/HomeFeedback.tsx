import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import '../styles/surveys.css';

type PublicFeedback = { id: string; displayName: string; message: string; createdAt: string };
export default function HomeFeedback() {
  const [items, setItems] = useState<PublicFeedback[]>([]);
  useEffect(() => {
    let active = true;
    api.get<{ items: PublicFeedback[] }>('/api/v1/feedback/public').then((data) => { if (active) setItems(data.items ?? []); }).catch(() => { if (active) setItems([]); });
    return () => { active = false; };
  }, []);
  if (!items.length) return null;
  return <section className="py-feedback-public" aria-labelledby="py-feedback-public-title"><div className="py-feedback-public-head"><span className="py-survey-kicker">تجربهٔ کاربران</span><h2 id="py-feedback-public-title">نظرات و پیشنهادات کاربران</h2><p>دیدگاه‌هایی که با اجازهٔ کاربران و پس از بررسی مدیر منتشر شده‌اند.</p></div><div className="py-feedback-public-grid">{items.map((item) => <article className="py-feedback-quote" key={item.id}><span className="py-feedback-quote-mark" aria-hidden="true">“</span><p>{item.message}</p><div className="py-feedback-quote-author"><span className="py-feedback-avatar" aria-hidden="true">{Array.from(item.displayName.trim())[0] ?? 'پ'}</span><div><strong>{item.displayName}</strong><small>کاربر پُست‌یار</small></div></div></article>)}</div></section>;
}
