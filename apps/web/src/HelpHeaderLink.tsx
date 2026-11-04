import { MaterialIcon } from './MaterialIcon';
import './HelpHeaderLink.css';

export function HelpHeaderLink() {
  return <a className="help-header-link" href="/ajuda" aria-label="Central de Ajuda" title="Central de Ajuda"><MaterialIcon name="help_outline"/></a>;
}
