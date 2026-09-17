import { db } from "./firebase-config.js";
import { protegerPagina, sair } from "./auth-guard.js";
import { calcularStatus, formatarDiasRestantes } from "./status.js";
import { mostrarToast } from "./toast.js";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

document.getElementById("link-sair").addEventListener("click", (e) => {
  e.preventDefault();
  sair();
});

let estabelecimentoAtual = null;

protegerPagina(async ({ estabelecimento }) => {
  estabelecimentoAtual = estabelecimento;
  document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;
  await carregar();
});

async function carregar() {
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
      const produto = produtos[dados.produtoId] || { nome: "(produto removido)" };
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
    div.className = "painel";
    div.innerHTML = `
      <div class="lote lote--${l.status}" style="border:none; padding:0; margin-bottom:0.6rem">
        <div class="lote-info">
          <div class="lote-produto">${l.produtoNome}</div>
          <div class="lote-meta">${l.local || "—"} · ${l.quantidade} un.</div>
        </div>
        <div class="lote-dados">
          <div class="lote-dias lote-dias--${l.status}">${formatarDiasRestantes(l.diasRestantes)}</div>
        </div>
      </div>
      <label>
        <input type="checkbox" data-id="${l.id}" class="chk-promo" ${l.promocaoAtiva ? "checked" : ""} style="width:auto; display:inline-block; margin-right:0.4rem" />
        Marcar como promoção
      </label>
      <label>Preço promocional (R$)</label>
      <input type="number" step="0.01" min="0" class="input-preco-promo" data-id="${l.id}" value="${l.precoPromocional ?? ""}" />
      <button class="btn btn-secundario btn-salvar-promo" data-id="${l.id}">Salvar</button>
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
