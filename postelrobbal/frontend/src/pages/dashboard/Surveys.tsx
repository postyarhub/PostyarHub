import HomeSurvey from '../../components/HomeSurvey';

export default function Surveys() {
  return (
    <div className="py-surveys-dashboard" dir="rtl">
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 900 }}>نظرسنجی‌های پُست‌یار</h1>
        <p style={{ margin: 0, color: 'var(--text-2)', lineHeight: 1.9 }}>
          در نظرسنجی‌های فعال شرکت کنید. ساخت و انتشار نظرسنجی فقط از پنل مدیریت انجام می‌شود.
        </p>
      </header>
      <HomeSurvey showEmptyState />
    </div>
  );
}
