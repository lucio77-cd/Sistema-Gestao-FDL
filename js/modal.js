import { escapeHtml } from "./status.js";

export function confirmarAcao({
  titulo,
  mensagem,
  textoConfirmar = "Confirmar",
  textoCancelar = "Cancelar",
  perigo = false,
}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="modal-titulo" aria-describedby="modal-mensagem">
        <h2 id="modal-titulo">${escapeHtml(titulo)}</h2>
        <p id="modal-mensagem">${escapeHtml(mensagem)}</p>
        <div class="modal-acoes">
          <button type="button" class="btn-secundario" data-acao="cancelar">${escapeHtml(textoCancelar)}</button>
          <button type="button" class="btn ${perigo ? "btn-perigo" : ""}" data-acao="confirmar">${escapeHtml(textoConfirmar)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add("modal-aberto");

    const botaoConfirmar = overlay.querySelector('[data-acao="confirmar"]');
    const botaoCancelar = overlay.querySelector('[data-acao="cancelar"]');
    botaoConfirmar.focus();

    function fechar(resultado) {
      document.body.classList.remove("modal-aberto");
      document.removeEventListener("keydown", aoTeclar);
      overlay.remove();
      resolve(resultado);
    }

    function aoTeclar(e) {
      if (e.key === "Escape") fechar(false);
    }

    botaoConfirmar.addEventListener("click", () => fechar(true));
    botaoCancelar.addEventListener("click", () => fechar(false));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) fechar(false);
    });
    document.addEventListener("keydown", aoTeclar);
  });
}
