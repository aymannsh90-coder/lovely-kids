import { API_BASE_URL } from "./lib/api";

const modules = [
  {
    title: "فتح اليوم",
    description: "إدخال رصيد بداية الصندوق وبدء جلسة العمل.",
    icon: "💰"
  },
  {
    title: "فاتورة مبيعات",
    description: "مسح الباركود، إضافة الأصناف وإتمام البيع.",
    icon: "🧾"
  },
  {
    title: "مصروفات اليوم",
    description: "تسجيل السحوبات والمصروفات المرتبطة باليوم.",
    icon: "💸"
  },
  {
    title: "تقرير نهاية اليوم",
    description: "ملخص المبيعات والمصروفات ورصيد الصندوق.",
    icon: "📊"
  }
];

export default function App() {
  return (
    <main className="page">
      <section className="shell">
        <header className="header">
          <div>
            <span className="brand">Lovely Kids</span>
            <h1>نظام نقطة البيع</h1>
            <p>
              الأساس الأول لنظام المبيعات اليومي، مبني للتوسع إلى POS كامل.
            </p>
          </div>

          <div className="version">POS V1</div>
        </header>

        <section className="modules" aria-label="أقسام النظام">
          {modules.map((module) => (
            <article className="module-card" key={module.title}>
              <span className="module-icon" aria-hidden="true">
                {module.icon}
              </span>
              <h2>{module.title}</h2>
              <p>{module.description}</p>
              <span className="coming-soon">قيد البناء</span>
            </article>
          ))}
        </section>

        <footer className="footer">
          <div>
            <strong>المخزون:</strong>
            <span>مركزي وموحّد مع المتجر الإلكتروني والتطبيق</span>
          </div>

          <code>{API_BASE_URL}</code>
        </footer>
      </section>
    </main>
  );
}
