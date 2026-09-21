import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
import { escapeHtml } from "./status.js";
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
const container = document.getElementById("lista-produtos");
const campoBusca = document.getElementById("busca-produto");

protegerPagina(async ({ estabelecimento }) => {
  estabelecimentoAtual = estabelecimento;
  document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;
  await carregarProdutos();
});

// A busca filtra os cartões já renderizados — evita nova consulta ao
// Firestore a cada tecla e continua funcionando depois de qualquer
// re-render, porque relê os elementos do DOM no momento do filtro.
campoBusca.addEventListener("input", () => {
  const termo = campoBusca.value.trim().toLowerCase();
  container.querySelectorAll(".produto-item").forEach((item) => {
    const nome = item.querySelector(".produto-nome").textContent.toLowerCase();
    item.hidden = termo !== "" && !nome.includes(termo);
  });
});

async function carregarProdutos() {
  container.innerHTML = skeletonLotes(4);

  const snap = await getDocs(
    query(collection(db, "produtos"), where("estabelecimentoId", "==", estabelecimentoAtual.id))
  );

  if (snap.empty) {
    container.innerHTML =
      '<p class="mensagem-vazio">Nenhum produto cadastrado ainda. Cadastre pela aba "Adicionar novo" da Vistoria.</p>';
    return;
  }

  const produtos = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  container.innerHTML = "";

  produtos.forEach((p) => {
    const semCodigo = !p.codigoBarras;
    const precoVenda = (Number(p.precoVenda) || 0).toFixed(2);

    const details = document.createElement("details");
    details.className = "produto-item";
    details.innerHTML = `
      <summary>
        <span class="produto-nome">${escapeHtml(p.nome)}</span>
        <span class="produto-resumo-dados">
          ${semCodigo ? '<span class="produto-aviso" title="Sem código de barras cadastrado">● sem código</span>' : ""}
          <span>R$ ${precoVenda}</span>
        </span>
      </summary>
      <div class="produto-form">
        <label>Nome</label>
        <input type="text" class="pe-nome" value="${escapeHtml(p.nome)}" />

        <label>Categoria</label>
        <input type="text" class="pe-categoria" value="${escapeHtml(p.categoria || "")}" />

        <div class="linha-form">
          <div>
            <label>Preço de custo (R$)</label>
            <input type="number" step="0.01" min="0" class="pe-custo" value="${p.precoCusto ?? ""}" />
          </div>
          <div>
            <label>Preço de venda (R$)</label>
            <input type="number" step="0.01" min="0" class="pe-venda" value="${p.precoVenda ?? ""}" />
          </div>
        </div>

        <label>Antecedência de alerta específica (opcional)</label>
        <input type="number" min="0" class="pe-dias-alerta" value="${p.diasAlerta ?? ""}" placeholder="Deixe em branco para usar o padrão" />

        <label>Código de barras (para o Caixa)</label>
        <input type="text" class="pe-codigo" value="${escapeHtml(p.codigoBarras || "")}" placeholder="Escaneie ou digite o código" />

        <button type="button" class="btn btn-salvar-produto" data-id="${p.id}">Salvar alterações</button>
      </div>
    `;
    container.appendChild(details);
  });

  container.querySelectorAll(".btn-salvar-produto").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const form = btn.closest(".produto-form");
      const details = btn.closest(".produto-item");
      const nome = form.querySelector(".pe-nome").value.trim();

      if (!nome) {
        mostrarToast("O nome não pode ficar vazio.", "erro");
        return;
      }

      const diasAlertaValor = form.querySelector(".pe-dias-alerta").value;
      const dados = {
        nome,
        categoria: form.querySelector(".pe-categoria").value.trim(),
        precoCusto: Number(form.querySelector(".pe-custo").value) || 0,
        precoVenda: Number(form.querySelector(".pe-venda").value) || 0,
        codigoBarras: form.querySelector(".pe-codigo").value.trim(),
        diasAlerta: diasAlertaValor === "" ? null : Number(diasAlertaValor),
      };

      btn.disabled = true;
      const textoOriginal = btn.textContent;
      btn.textContent = "Salvando…";

      try {
        await updateDoc(doc(db, "produtos", btn.dataset.id), dados);
        details.querySelector(".produto-nome").textContent = nome;
        details.querySelector(".produto-resumo-dados span:last-child").textContent = `R$ ${dados.precoVenda.toFixed(2)}`;
        mostrarToast(`"${nome}" atualizado.`, "ok");
      } catch (erro) {
        console.error(erro);
        mostrarToast("Não foi possível salvar. Tente novamente.", "erro");
      } finally {
        btn.disabled = false;
        btn.textContent = textoOriginal;
      }
    });
  });
}
