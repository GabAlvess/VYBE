import test from 'node:test';
import assert from 'node:assert/strict';
import { mayEditArticle, mayManageNews, mayReviewNews, maySubmitForReview, mayViewEditorial, mayWriteNews } from './routes/newsPolicy.js';

test('news roles grant separate writing, review, and administration powers',()=>{
 assert.equal(mayWriteNews([]),false);assert.equal(mayViewEditorial([]),false);assert.equal(mayWriteNews(['NEWS_WRITER']),true);assert.equal(mayReviewNews(['NEWS_WRITER']),false);assert.equal(mayReviewNews(['NEWS_EDITOR']),true);assert.equal(mayManageNews(['NEWS_EDITOR']),false);assert.equal(mayManageNews(['NEWS_ADMIN']),true);
});
test('writers only edit and submit their own editable drafts',()=>{
 const roles=['NEWS_WRITER'] as const;assert.equal(mayEditArticle({roles,author:true,status:'DRAFT'}),true);assert.equal(mayEditArticle({roles,author:false,status:'DRAFT'}),false);assert.equal(mayEditArticle({roles,author:true,status:'PUBLISHED'}),false);assert.equal(maySubmitForReview({roles,author:true,status:'DRAFT'}),true);assert.equal(maySubmitForReview({roles,author:true,status:'PUBLISHED'}),false);
});
test('editors can edit and review but only admins manage the newsroom',()=>{
 const roles=['NEWS_EDITOR'] as const;assert.equal(mayEditArticle({roles,author:false,status:'PUBLISHED'}),true);assert.equal(mayReviewNews(roles),true);assert.equal(mayManageNews(roles),false);
});
