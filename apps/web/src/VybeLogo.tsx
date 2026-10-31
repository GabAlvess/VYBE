import type { ImgHTMLAttributes } from 'react';

type VybeLogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> & {
  variant?: 'full' | 'symbol';
  label?: string;
};

/** Official VYBE wordmark and symbol, used consistently throughout the apps. */
export function VybeLogo({ variant = 'full', label = 'VYBE', ...props }: VybeLogoProps) {
  return <img src={variant === 'full' ? '/vybe-logo-exact.png' : '/vybe-symbol-exact.png'} alt={label} {...props}/>;
}
