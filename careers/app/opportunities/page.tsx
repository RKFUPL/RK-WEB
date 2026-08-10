import { SiteFooter } from '../../components/site-footer';
import { SiteHeader } from '../../components/site-header';

const roles = [
  ['Fashion Design Intern', 'Design', 'Kolkata'],
  ['Production Coordinator', 'Production', 'Kolkata'],
  ['Client Experience Associate', 'Retail', 'Mumbai'],
  ['Content & Social Associate', 'Brand', 'Kolkata'],
] as const;

export default function OpportunitiesPage() {
  return (
    <main>
      <div className="inner-header"><SiteHeader /></div>
      <section className="page-intro">
        <p className="eyebrow">Opportunities</p>
        <h1>Make your mark<br />with the house.</h1>
        <p>Explore current areas of interest. Role availability is confirmed during the application process.</p>
      </section>
      <section className="roles" aria-label="Career opportunities">
        {roles.map(([title, team, location], index) => (
          <a key={title} href={`mailto:careers@rashikapoor.com?subject=${encodeURIComponent(`Application: ${title}`)}`} className="role-row">
            <span>{String(index + 1).padStart(2, '0')}</span><h2>{title}</h2><p>{team}</p><p>{location}</p><strong>Apply →</strong>
          </a>
        ))}
      </section>
      <section className="application-note"><p>Don’t see your discipline?</p><a href="mailto:careers@rashikapoor.com?subject=General career enquiry">Introduce yourself →</a></section>
      <SiteFooter />
    </main>
  );
}
