import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
import { calcularStatus, formatarDiasRestantes, STATUS_ICONE, escapeHtml } from "./status.js";
import { mostrarToast } from "./toast.js";
import { skeletonLotes } from "./skeleton.js";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

iniciarNavegacao();

let estabelecimentoAtual = null;

protegerPagina(async ({ estabelecimento }) => {
  estabelecimentoAtual = estabelecimento;
  document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;
  await carregar();
});

async function carregar() {
  const container = document.getElementById("lista-promocoes");
  container.innerHTML = skeletonLotes(3);

  const diasAlertaPadrao = estabelecimentoAtual.diasAlertaPadrao ?? 3;

  const [produtosSnap, lotesSnap] = await Promise.all([
    getDocs(query(collection(db, "produtos"), where("estabelecimentoId", "==", estabelecimentoAtual.id))),
    getDocs(query(collection(db, "lotes"), where("estabelecimentoId", "==", estabelecimentoAtual.id))),
  ]);

  const produtos = {};
  produtosSnap.forEach((d) => (produtos[d.id] = { id: d.id, ...d.data() }));

  const lotes = lotesSnap.docs
    .map((d) => {
      const dados = d.data();
      const produto = produtos[dados.produtoId] || { nome: dados.produtoNome || "(produto removido)" };
      const diasAlerta = produto.diasAlerta ?? diasAlertaPadrao;
      const { diasRestantes, status } = calcularStatus(dados.dataVencimento, diasAlerta, dados.promocaoAtiva);
      return { id: d.id, ...dados, produtoNome: produto.nome, diasRestantes, status };
    })
    .filter((l) => l.status === "atencao" || l.status === "vencido" || l.status === "promocao")
    .sort((a, b) => a.diasRestantes - b.diasRestantes);

  renderizar(lotes);
}

function renderizar(lotes) {
  const container = document.getElementById("lista-promocoes");
  container.innerHTML = "";

  if (lotes.length === 0) {
    container.innerHTML = '<p class="mensagem-vazio">Nenhum lote elegível para promoção no momento.</p>';
    return;
  }

  lotes.forEach((l) => {
    const div = document.createElement("div");
    div.className = `lote lote--${l.status}`;
    div.innerHTML = `
      <div class="lote-info">
        <div class="lote-produto">${STATUS_ICONE[l.status]} ${escapeHtml(l.produtoNome)}</div>
        <div class="lote-meta">${escapeHtml(l.local || "—")} · ${l.quantidade} un.</div>
        <div class="lote-preco-venda">
          <label class="switch">
            <input type="checkbox" data-id="${l.id}" class="chk-promo" ${l.promocaoAtiva ? "checked" : ""} />
            <span class="switch-trilho" aria-hidden="true"></span>
            <span class="switch-rotulo">Promoção</span>
          </label>
          <input type="number" step="0.01" min="0" class="input-preco-promo" data-id="${l.id}" placeholder="Preço promo. (R$)" value="${l.precoPromocional ?? ""}" />
          <button type="button" class="btn-secundario btn-salvar-promo" data-id="${l.id}">Salvar</button>
        </div>
      </div>
      <div class="lote-dados">
        <div class="lote-dias lote-dias--${l.status}">${formatarDiasRestantes(l.diasRestantes)}</div>
      </div>
    `;
    container.appendChild(div);
  });

  container.querySelectorAll(".btn-salvar-promo").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const promocaoAtiva = container.querySelector(`.chk-promo[data-id="${id}"]`).checked;
      const precoPromocional = Number(container.querySelector(`.input-preco-promo[data-id="${id}"]`).value) || null;

      btn.disabled = true;
      try {
        await updateDoc(doc(db, "lotes", id), { promocaoAtiva, precoPromocional });
        mostrarToast("Promoção atualizada.", "ok");
        await carregar();
      } catch (erro) {
        console.error(erro);
        mostrarToast("Não foi possível salvar. Tente novamente.", "erro");
        btn.disabled = false;
      }
    });
  });
}
