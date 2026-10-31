type MaterialIconProps = { name: string; className?: string; filled?: boolean; title?: string };

export function MaterialIcon({ name, className = '', filled = false, title }: MaterialIconProps) {
  return <span className={`material-symbol ${className}`} aria-hidden={title ? undefined : true} aria-label={title} role={title ? 'img' : undefined} style={{ fontVariationSettings: `'FILL' ${filled ? 1 : 0}` }}>{name}</span>;
}
