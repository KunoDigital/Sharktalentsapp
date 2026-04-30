import { Link } from 'react-router-dom';
import './empty-state.css';

type Props = {
  icon: string;
  title: string;
  description?: string;
  cta?: { label: string; to?: string; onClick?: () => void };
  hint?: string;
};

export default function EmptyState({ icon, title, description, cta, hint }: Props) {
  return (
    <div className="empty-state" role="status">
      <div className="empty-state-icon" aria-hidden="true">{icon}</div>
      <h3 className="empty-state-title">{title}</h3>
      {description && <p className="empty-state-desc">{description}</p>}
      {cta && (cta.to ? (
        <Link to={cta.to} className="btn-primary empty-state-cta">{cta.label}</Link>
      ) : (
        <button className="btn-primary empty-state-cta" onClick={cta.onClick}>{cta.label}</button>
      ))}
      {hint && <p className="empty-state-hint">{hint}</p>}
    </div>
  );
}
