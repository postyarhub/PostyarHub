import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Badge, Button, Card, EmptyState, PageLoading } from '../../components/ui';
import { NavIcon } from '../../components/icons';
import { PLATFORM_FA, faDigits, faFileSize, faMoney, faNumber } from '../../lib/format';
import { ADMIN_SECTIONS_FLAT, PlatformIcon, errText, type AdminOverview } from './shared';

type PF = 'telegram'|'bale'|'rubika';
interface AdminAnalytics { events:{total:number;sent:number;failed:number}; successRate:number; platforms:Record<string,{sent:number;failed:number}>; revenue:{paymentsCompletedRial:number;subscriptionRevenueRial:number;paymentsCompleted:number;subscriptionsRenewed:number}; automation:{ai:{requested:number;completed:number;failed:number;successRate:number};workflows:{started:number;completed:number;failed:number;successRate:number}}; links:{clicks:number}; }

function Bar({ value, max }: { value: number; max: number }) { return <div style={{ height: 9, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${max ? Math.min(100, value/max*100) : 0}%`, background: 'var(--brand)', borderRadius: 999 }} /></div>; }
function KPI({ to, icon, label, value, meta }: { to?: string; icon: string; label: string; value: string; meta?: string }) { const body=<Card style={{ minWidth:0, height:'100%', transition:'transform .18s ease, box-shadow .18s ease' }}><div style={{display:'flex',justifyContent:'space-between',gap:10}}><span style={{fontSize:23}}>{icon}</span>{to?<span style={{fontSize:12,color:'var(--brand)'}}>مشاهده ←</span>:null}</div><div style={{fontSize:23,fontWeight:900,marginTop:10}}>{value}</div><div style={{fontSize:12.5,color:'var(--text-2)',marginTop:3}}>{label}</div>{meta?<div style={{fontSize:11.5,color:'var(--text-2)',marginTop:6}}>{meta}</div>:null}</Card>; return to?<Link to={to} style={{textDecoration:'none',color:'inherit'}}>{body}</Link>:body; }

export default function AdminHome() {
  const [data,setData]=useState<AdminOverview|null>(null); const [analytics,setAnalytics]=useState<AdminAnalytics|null>(null); const [loading,setLoading]=useState(true); const [fatalError,setFatalError]=useState<string|null>(null); const [retryToken,setRetryToken]=useState(0);
  useEffect(()=>{let alive=true;(async()=>{setLoading(true);setFatalError(null);const [overviewResult,analyticsResult]=await Promise.allSettled([api.get<AdminOverview>('/api/v1/admin/overview'),api.get<AdminAnalytics>('/api/v1/admin/analytics/overview?days=30')]);if(!alive)return;if(overviewResult.status==='fulfilled'){setData(overviewResult.value);}else{setData(null);setFatalError(errText(overviewResult.reason,'دریافت آمار مدیریتی ناموفق بود.'));}if(analyticsResult.status==='fulfilled'){setAnalytics(analyticsResult.value);}else{setAnalytics(null);}setLoading(false)})().catch((err:unknown)=>{if(!alive)return;setFatalError(errText(err,'دریافت آمار مدیریتی ناموفق بود.'));setLoading(false)});return()=>{alive=false}},[retryToken]);
  const planTotal=data?.subscriptions?.active??0; const plans=data?.subscriptions?.byPlan??[]; const maxPlan=Math.max(1,...plans.map(p=>p.count));
  const pfData = useMemo(()=>{const b=data?.bots?.byPlatform;const c=data?.channels?.byPlatform; return (['telegram','bale','rubika'] as PF[]).map(p=>({platform:p,channels:c?.[p]??{total:data?.channels?.[p]??0,active:0,inactive:0},bots:b?.[p]??{total:data?.bots?.[p]??0,active:0,inactive:0}}))},[data]);
  if(loading && !data)return <PageLoading/>;
  if(fatalError && !data)return <div className="admin-page"><Card className="admin-error-state"><div className="admin-error-state__icon">!</div><div className="admin-error-state__body"><strong>بارگذاری مرکز مدیریت انجام نشد</strong><p>{fatalError}</p><Button variant="primary" onClick={()=>setRetryToken(v=>v+1)}>تلاش مجدد</Button></div></Card></div>;
  return <div className="admin-page">
    <header className="admin-hero">
      <div><span className="admin-eyebrow">پنل مدیریتی</span><h1>مرکز مدیریت</h1><p>نمای عملیاتی کاربران، درآمد، اتصال پلتفرم‌ها، اشتراک و هستهٔ تحلیل مشترک.</p></div>
      <div className="admin-hero__status"><span className="admin-hero__dot" /><div><strong>وضعیت عملیاتی</strong><span>شاخص‌های ۳۰ روزه و منابع اصلی</span></div></div>
    </header>

    <section className="admin-kpi-grid">
      <KPI to="/dashboard/admin/users" icon="👥" label="کاربران کل" value={faNumber(data?.users?.total??0)} meta={`فعال ${faNumber(data?.users?.active??0)} · جدید ۳۰ روز ${faNumber(data?.users?.new30d??0)}`} />
      <KPI to="/dashboard/admin/users" icon="✓" label="کاربران فعال" value={faNumber(data?.users?.active??0)} meta={`تعلیق‌شده ${faNumber(data?.users?.suspended??0)}`} />
      <KPI to="/dashboard/admin/payments" icon="₽" label="درآمد تأییدشده ۳۰ روز" value={faMoney(data?.payments?.verifiedSum30d??0)} meta={`تعداد پرداخت ${faNumber(data?.payments?.verifiedCount30d??0)}`} />
      <KPI to="/dashboard/admin/plans" icon="◆" label="اشتراک فعال" value={faNumber(data?.subscriptions?.active??0)} meta="تفکیک پلن در پایین صفحه" />
    </section>

    <section className="admin-pair-grid">
      {(['channels','bots'] as const).map(kind => <Card key={kind} className="admin-panel">
        <div className="admin-panel__head"><div><h2>{kind === 'channels' ? 'کانال‌ها' : 'ربات‌ها'}</h2><p>وضعیت فعال و غیرفعال به تفکیک پلتفرم</p></div><Link to={kind==='channels'?'/dashboard/admin/channels':'/dashboard/admin/bots'}>مدیریت ←</Link></div>
        <div className="admin-platform-grid">{pfData.map(p => { const x=p[kind]; return <div key={p.platform} className="admin-platform-card"><div className="admin-platform-card__name"><PlatformIcon platform={p.platform} size={21}/><strong>{PLATFORM_FA[p.platform]}</strong></div><div className="admin-platform-card__total">{faNumber(x.total)}</div><div className="admin-platform-card__status"><Badge tone="success">فعال {faNumber(x.active)}</Badge><Badge tone="muted">غیرفعال {faNumber(x.inactive)}</Badge></div></div>; })}</div>
      </Card>)}
    </section>

    <Card className="admin-analytics-panel">
      <div className="admin-panel__head"><div><span className="admin-panel__eyebrow">هستهٔ تحلیلی مشترک</span><h2>تحلیل عملکرد سیستم</h2><p>۳۰ روز اخیر · محتوا · ارسال · درآمد · هوشمندسازی</p></div><Link to="/dashboard/analytics">تحلیل کامل ←</Link></div>
      {analytics ? <div className="admin-analytics-body">
        <div className="admin-analytics-kpis">
          <Link to="/dashboard/analytics" className="admin-analytics-kpi"><span>کل رویداد</span><strong>{faNumber(analytics.events.total)}</strong></Link>
          <Link to="/dashboard/analytics" className="admin-analytics-kpi admin-analytics-kpi--success"><span>ارسال موفق</span><strong>{faNumber(analytics.events.sent)}</strong></Link>
          <Link to="/dashboard/analytics" className="admin-analytics-kpi admin-analytics-kpi--danger"><span>خطا</span><strong>{faNumber(analytics.events.failed)}</strong></Link>
          <Link to="/dashboard/analytics" className="admin-analytics-kpi"><span>کلیک لینک</span><strong>{faNumber(analytics.links.clicks)}</strong></Link>
        </div>

        <div className="admin-analytics-grid">
          <div className="admin-analytics-box"><div className="admin-analytics-box__head"><div><strong>عملکرد پلتفرم‌ها</strong><span>موفق و ناموفق</span></div></div>{(['telegram','bale','rubika','wordpress'] as const).map(p => { const x=analytics.platforms?.[p]??{sent:0,failed:0}; const total=Number(x.sent)+Number(x.failed); return <div key={p} className="admin-platform-row"><div className="admin-platform-row__top"><span><PlatformIcon platform={p} size={18}/>{PLATFORM_FA[p]}</span><strong>{faNumber(total)}</strong></div><div className="admin-platform-row__bar"><div style={{width:`${total?Math.min(100,(Number(x.sent)/total)*100):0}%`}} /></div><div className="admin-platform-row__meta"><span>موفق {faNumber(Number(x.sent))}</span><span>خطا {faNumber(Number(x.failed))}</span></div></div>; })}</div>

          <div className="admin-analytics-box admin-analytics-box--summary"><div className="admin-analytics-box__head"><div><strong>درآمد و هوشمندسازی</strong><span>شاخص‌های کلیدی</span></div></div><div className="admin-summary-list"><div><span>درآمد موفق</span><strong>{faMoney(analytics.revenue.paymentsCompletedRial)}</strong></div><div><span>تمدید اشتراک</span><strong>{faNumber(analytics.revenue.subscriptionsRenewed)}</strong></div><div><span>هوش مصنوعی کامل‌شده</span><strong>{faNumber(analytics.automation.ai.completed)}</strong></div><div><span>گردش‌کار کامل‌شده</span><strong>{faNumber(analytics.automation.workflows.completed)}</strong></div></div><Link className="admin-summary-link" to="/dashboard/analytics">مشاهده جزئیات تحلیل ←</Link></div>
        </div>
      </div> : <div className="admin-analytics-unavailable"><EmptyState icon="📊" title="هستهٔ تحلیل در دسترس نیست" description="اطلاعات اصلی پنل مدیریت در دسترس است؛ جزئیات هستهٔ تحلیل فعلاً قابل دریافت نیست." /><Button variant="ghost" loading={loading} onClick={()=>setRetryToken(v=>v+1)}>تلاش مجدد تحلیل</Button></div>}
    </Card>

    <section className="admin-bottom-grid">
      <Card className="admin-panel"><div className="admin-panel__head"><div><h2>اشتراک‌های فعال</h2><p>توزیع کاربران میان پلن‌ها</p></div><Badge tone="brand">{faNumber(planTotal)} فعال</Badge></div>{plans.length===0?<EmptyState icon="💎" title="اشتراک فعالی نیست" description="توزیع پلن‌ها پس از فعال‌شدن اشتراک نمایش داده می‌شود."/>:<div className="admin-plan-list">{plans.map(p=><div key={p.planName} className="admin-plan-row"><div className="admin-plan-row__top"><strong>{p.planName}</strong><span>{faNumber(p.count)} · {planTotal?faNumber(Math.round(p.count/planTotal*100)):faDigits(0)}٪</span></div><Bar value={p.count} max={maxPlan}/></div>)}</div>}</Card>
      <Card className="admin-panel"><div className="admin-panel__head"><div><h2>عملکرد و مصرف</h2><p>وضعیت تولید و ارسال محتوا</p></div><Link to="/dashboard/posts">پست‌ها ←</Link></div><div className="admin-usage-grid"><div><span>پست‌های کل</span><strong>{faNumber(data?.posts?.total??0)}</strong></div><div><span>منتشرشده ۳۰ روز</span><strong>{faNumber(data?.posts?.published30d??0)}</strong></div><div><span>ارسال موفق ۲۴ ساعت</span><strong>{faNumber(data?.usage?.deliveries24h??0)}</strong></div><div><span>ارسال ناموفق ۲۴ ساعت</span><strong>{faNumber(data?.usage?.deliveriesFailed24h??0)}</strong></div><div><span>حجم رسانه</span><strong>{faFileSize(data?.usage?.mediaBytes??0)}</strong></div></div></Card>
    </section>

    <Card className="admin-panel"><div className="adm-card-head"><strong>دسترسی سریع</strong><span className="adm-card-head__meta">بخش‌های قابل رهگیری</span></div><div className="adm-quick">{ADMIN_SECTIONS_FLAT.filter(s=>!s.end).map(s=><Link key={s.to} to={s.to} className="adm-quick__tile"><span className="adm-quick__icon"><NavIcon name={s.icon} size={19}/></span><span>{s.label}</span></Link>)}</div></Card>
  </div>;
}
