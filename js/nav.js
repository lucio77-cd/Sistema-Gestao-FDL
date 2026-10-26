import { sair } from "./auth-guard.js";

export function iniciarNavegacao() {
  const paginaAtual = document.body.dataset.paginaAtual;

  const btnMais = document.getElementById("btn-mais");
  const menuMais = document.getElementById("menu-mais");

  // Garante o link "Cozinha" no menu "Mais" de todas as páginas, sem precisar
  // editar cada HTML. Se o HTML já tiver o link, nada é duplicado.
  if (menuMais && !menuMais.querySelector('a[href="cozinha.html"]')) {
    const linkCozinha = document.createElement("a");
    linkCozinha.href = "cozinha.html";
    linkCozinha.dataset.pagina = "cozinha";
    linkCozinha.textContent = "Cozinha";
    const referencia =
      menuMais.querySelector('a[href="caixa.html"]') || menuMais.querySelector("#link-sair");
    if (referencia) menuMais.insertBefore(linkCozinha, referencia);
    else menuMais.appendChild(linkCozinha);
  }

  document.querySelectorAll("[data-pagina]").forEach((el) => {
    if (el.dataset.pagina !== paginaAtual) return;
    el.classList.add("ativo");
    if (el.tagName === "A") el.setAttribute("aria-current", "page");
  });

  if (btnMais && ["estoque", "cozinha", "caixa", "configuracoes", "graficos"].includes(paginaAtual)) {
    btnMais.classList.add("ativo");
  }

  if (btnMais && menuMais) {
    btnMais.addEventListener("click", (e) => {
      e.stopPropagation();
      const estavaAberto = !menuMais.hidden;
      menuMais.hidden = estavaAberto;
      btnMais.setAttribute("aria-expanded", String(!estavaAberto));
    });

    document.addEventListener("click", (e) => {
      if (menuMais.hidden) return;
      if (menuMais.contains(e.target) || btnMais.contains(e.target)) return;
      menuMais.hidden = true;
      btnMais.setAttribute("aria-expanded", "false");
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !menuMais.hidden) {
        menuMais.hidden = true;
        btnMais.setAttribute("aria-expanded", "false");
      }
    });
  }

  const linkSair = document.getElementById("link-sair");
  if (linkSair) {
    linkSair.addEventListener("click", (e) => {
      e.preventDefault();
      linkSair.setAttribute("aria-disabled", "true");
      linkSair.textContent = "Saindo…";
      sair().catch((erro) => {
        console.error("Falha ao sair:", erro);
        linkSair.removeAttribute("aria-disabled");
        linkSair.textContent = "Sair";
      });
    });
  }
}
