// Toast simples, reutilizado em todas as telas administrativas.
// Usa aria-live para leitores de tela anunciarem sem precisar de foco manual.

export function mostrarToast(mensagem, tipo = "ok") {
  let toast = document.getElementById("toast-global");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast-global";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }

  toast.className = `toast toast--${tipo} toast--visivel`;
  toast.textContent = mensagem;

  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove("toast--visivel");
  }, 3200);
}
