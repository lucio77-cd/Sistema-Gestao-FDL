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
