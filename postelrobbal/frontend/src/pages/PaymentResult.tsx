import { useSearchParams } from 'react-router-dom';
import { Card } from '../components/ui';

export default function PaymentResult() {
  const [params] = useSearchParams();
  const ok = params.get('payment') === 'ok';
  return (
    <div style={{ maxWidth: 480, margin: '80px auto', padding: '0 20px' }}>
      <Card pad="lg" className="payment-result" >
        <div style={{ fontSize: 52, marginBottom: 12 }} aria-hidden="true">{ok ? '✅' : '⛔'}</div>
        <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>
          {ok ? 'پرداخت با موفقیت انجام شد' : 'پرداخت ناموفق بود'}
        </h1>
        <p style={{ color: 'var(--text-2)', fontSize: 14, marginBottom: 20 }}>
          {ok
            ? 'اشتراک یا موجودی شما در چند لحظه فعال می‌شود.'
            : 'در صورت کسر مبلغ، وجه به‌صورت خودکار بازگردانده می‌شود.'}
        </p>
        <a href="/dashboard" className="btn btn-primary">بازگشت به داشبورد</a>
      </Card>
    </div>
  );
}
