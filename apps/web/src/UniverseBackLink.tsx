import { MaterialIcon } from './MaterialIcon';
import './UniverseBackLink.css';

export function UniverseBackLink({ className = '' }: { className?: string }) {
  return <a className={`universe-back-link ${className}`.trim()} href="/" aria-label="Voltar para o universo" title="Voltar para o universo">
    <MaterialIcon name="arrow_back"/>
  </a>;
}
