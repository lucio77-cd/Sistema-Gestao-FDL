// Marcação de "esqueleto" usada como estado de carregamento nas listas de
// lote, no lugar de um texto solto "Carregando…" — dá uma pista visual do
// formato do conteúdo que está a caminho e reduz a sensação de espera.
export function skeletonLotes(quantidade = 3) {
  return Array.from({ length: quantidade })
    .map(
      () => `
        <div class="skeleton-lote">
          <div class="skeleton-linha skeleton-linha--titulo"></div>
          <div class="skeleton-linha skeleton-linha--meta"></div>
        </div>
      `
    )
    .join("");
}
