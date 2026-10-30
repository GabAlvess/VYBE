const dialog = document.querySelector('#compose');
const feedback = document.querySelector('#feedback');
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
document.addEventListener('click', event => {
 const button = event.target.closest('button');
 if (!button) return;
 if (button.hasAttribute('data-compose')) dialog.showModal();
 if (button.hasAttribute('data-info')) feedback.textContent = button.dataset.info;
 if (button.hasAttribute('data-like')) {
  const pressed = button.getAttribute('aria-pressed') === 'true';
  const count = button.querySelector('span');
  button.setAttribute('aria-pressed', String(!pressed));
  button.setAttribute('aria-label', pressed ? 'Curtir publicação' : 'Descurtir publicação');
  count.textContent = Number(count.textContent) + (pressed ? -1 : 1);
 }
 if (button.hasAttribute('data-follow')) {
  const following = button.getAttribute('aria-pressed') === 'true';
  button.setAttribute('aria-pressed', String(!following));
  button.textContent = following ? 'Seguir personagem' : 'Seguindo';
 }
 if (button.hasAttribute('data-follow-icon')) {
  const following = button.getAttribute('aria-pressed') === 'true';
  button.setAttribute('aria-pressed', String(!following));
  button.setAttribute('aria-label', button.getAttribute('aria-label').replace(following ? 'Deixar de seguir' : 'Seguir', following ? 'Seguir' : 'Deixar de seguir'));
  button.innerHTML = icon(following ? 'plus' : 'check');
 }
});
document.querySelector('#cancel-compose').addEventListener('click', () => dialog.close());
document.querySelector('#compose-form').addEventListener('submit', event => {
 event.preventDefault();
 const input = document.querySelector('#post-text');
 const text = input.value.trim();
 if (!text) { input.setCustomValidity('Escreva algo para publicar.'); input.reportValidity(); return; }
 const article = document.createElement('article');
 article.className = 'post';
 article.style.marginBottom = '16px';
 article.innerHTML = `<div class="post-header"><span class="avatar">AM</span><div><b>Aurora Martins</b><small>@auroram · agora · demonstração</small></div></div><p></p><div class="post-actions"><button aria-label="Curtir publicação" aria-pressed="false" data-like>${icon('heart')} <span>0</span></button></div>`;
 article.querySelector('p').textContent = text;
 document.querySelector('#feed-posts').prepend(article);
 input.value = '';
 dialog.close();
 feedback.textContent = 'Publicação adicionada à demonstração local.';
});
document.querySelector('#post-text').addEventListener('input', event => event.target.setCustomValidity(''));
