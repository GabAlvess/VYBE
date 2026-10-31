import { MaterialIcon } from './MaterialIcon';
import './UniverseBackLink.css';

export function UniverseBackLink({ className = '' }: { className?: string }) {
  return <a className={`universe-back-link ${className}`.trim()} href="/">
    <MaterialIcon name="arrow_back"/>
    <span>Voltar para o universo</span>
  </a>;
}
