export type NewsRoleName='NEWS_WRITER'|'NEWS_EDITOR'|'NEWS_ADMIN';
export function mayWriteNews(roles:readonly NewsRoleName[]){return roles.some((role)=>['NEWS_WRITER','NEWS_EDITOR','NEWS_ADMIN'].includes(role));}
export function mayReviewNews(roles:readonly NewsRoleName[]){return roles.includes('NEWS_ADMIN');}
export function mayManageNews(roles:readonly NewsRoleName[]){return roles.includes('NEWS_ADMIN');}
export function mayEditArticle(input:{roles:readonly NewsRoleName[];author:boolean;status:string}){
  if(input.roles.includes('NEWS_ADMIN')||input.roles.includes('NEWS_EDITOR'))return true;
  return input.roles.includes('NEWS_WRITER')&&input.author&&['DRAFT','NEEDS_CHANGES','REJECTED'].includes(input.status);
}
export function maySubmitForReview(input:{roles:readonly NewsRoleName[];author:boolean;status:string}){
  return input.author&&mayWriteNews(input.roles)&&['DRAFT','PENDING_REVIEW','NEEDS_CHANGES','REJECTED'].includes(input.status);
}
export function mayViewEditorial(roles:readonly NewsRoleName[]){return mayWriteNews(roles);}
