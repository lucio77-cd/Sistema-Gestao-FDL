import { sair } from "./auth-guard.js";

export function iniciarNavegacao() {
  const paginaAtual = document.body.dataset.paginaAtual;

  document.querySelectorAll("[data-pagina]").forEach((el) => {
    if (el.dataset.pagina !== paginaAtual) return;
    el.classList.add("ativo");
    if (el.tagName === "A") el.setAttribute("aria-current", "page");
  });

  const btnMais = document.getElementById("btn-mais");
  const menuMais = document.getElementById("menu-mais");

  if (btnMais && ["caixa", "configuracoes"].includes(paginaAtual)) {
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
      sair();
    });
  }
}
