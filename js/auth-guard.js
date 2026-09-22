export function protegerPagina(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    try {
      const estabelecimento = await obterOuCriarEstabelecimento(user.uid);
      await callback({ user, estabelecimento });
    } catch (erro) {
      console.error("Falha ao carregar a página:", erro);
      mostrarErroCarregamento(erro);
    }
  });
}

function mostrarErroCarregamento(erro) {
  const main = document.querySelector("main");
  if (!main) return;
  const div = document.createElement("div");
  div.className = "painel";
  div.style.borderColor = "var(--vencido)";
  div.innerHTML = `
    <h2 style="margin-top:0; color:var(--vencido)">Não foi possível carregar</h2>
    <p class="legenda" style="margin-bottom:0.4rem">Detalhe técnico (pra copiar e me mandar):</p>
    <div class="rodape-token">${(erro && erro.message) || String(erro)}</div>
  `;
  main.prepend(div);
}
