interface ComingSoonPageProps {
  icon: string;
  title: string;
  description: string;
  points: string[];
}

export default function ComingSoonPage({
  icon,
  title,
  description,
  points,
}: ComingSoonPageProps) {
  return (
    <section className="coming-soon-page">
      <div className="coming-page-heading">
        <div className="coming-page-icon">{icon}</div>

        <div>
          <span className="coming-page-badge">
            البنية جاهزة — الوظيفة قيد التجهيز
          </span>

          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      <div className="coming-page-points">
        {points.map((point) => (
          <div key={point}>
            <span>✓</span>
            <p>{point}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
