import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <section className="ln-section">
      <div className="ln-section__head">
        <span className="ln-section__kicker">خطای ۴۰۴</span>
        <h1 className="ln-section__title">این صفحه پیدا نشد</h1>
        <p className="ln-section__sub">
          نشانی واردشده معتبر نیست یا صفحه جابه‌جا شده است. از صفحه اصلی یا مرکز راهنما ادامه دهید.
        </p>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 12 }}>
        <Link className="btn btn-primary" to="/">بازگشت به صفحه اصلی</Link>
        <a className="btn btn-ghost" href="/guides/">مرکز آموزش</a>
      </div>
    </section>
  );
}
