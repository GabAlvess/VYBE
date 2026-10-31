export function isLocalVybeHost() {
  return ['localhost', '127.0.0.1'].includes(window.location.hostname.toLowerCase());
}

export function communityHomeHref(subdomain: string) {
  if (isLocalVybeHost()) return '/';
  return `${window.location.protocol}//${subdomain}.vybe.com.br`;
}

export function activateLocalCommunity(subdomain: string) {
  if (isLocalVybeHost()) sessionStorage.setItem('vybe_active_community', subdomain);
}
