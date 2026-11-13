import { sair } from "./auth-guard.js";

export function iniciarNavegacao() {
  const paginaAtual = document.body.dataset.paginaAtual;

  const btnMais = document.getElementById("btn-mais");
  const menuMais = document.getElementById("menu-mais");

  // Mantém o submenu na própria barra lateral no desktop.
  if (menuMais && btnMais && btnMais.parentElement !== menuMais.parentElement) {
    btnMais.insertAdjacentElement("afterend", menuMais);
    btnMais.setAttribute("aria-controls", "menu-mais");
  }

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

  // Ícones consistentes nos atalhos de gestão, inclusive no link Cozinha criado acima.
  const iconesMenu = {
    "graficos.html": '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 15v-4"/><path d="M13 15V7"/><path d="M18 15V3"/>',
    "estoque.html": '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    "cozinha.html": '<path d="M4 10h16l-1 10H5L4 10Z"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/><path d="M9 4V2M15 4V2"/>',
    "caixa.html": '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/><path d="M7 3h10"/>',
    "configuracoes.html": '<path d="M4 7h9M17 7h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    "#": '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M21 19V5"/>'
  };
  menuMais?.querySelectorAll("a").forEach((link) => {
    const href = link.getAttribute("href") || "";
    const desenho = iconesMenu[href];
    if (!desenho || link.querySelector("svg")) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = desenho;
    link.prepend(svg);
  });

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
