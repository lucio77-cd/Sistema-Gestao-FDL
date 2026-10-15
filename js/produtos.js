import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
import { mostrarToast } from "./toast.js";
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
  await carregarProdutos();
});

async function carregarProdutos() {
  const container = document.getElementById("lista-produtos");
  container.innerHTML = '<p class="mensagem-vazio">Carregando…</p>';

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
    const div = document.createElement("div");
    div.className = "painel";
    div.innerHTML = `
      <label>Nome</label>
      <input type="text" class="pe-nome" value="${p.nome || ""}" />

      <label>Categoria</label>
      <input type="text" class="pe-categoria" value="${p.categoria || ""}" />

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

      <label>Estoque mínimo (opcional — usado no relatório de pedidos)</label>
      <input type="number" min="0" class="pe-minimo" value="${p.estoqueMinimo ?? ""}" placeholder="Ex: 12" />

      <label>Código de barras (para o Caixa)</label>
      <input type="text" class="pe-codigo" value="${p.codigoBarras || ""}" placeholder="Escaneie ou digite o código" />

      <button type="button" class="btn btn-salvar-produto" data-id="${p.id}">Salvar alterações</button>
    `;
    container.appendChild(div);
  });

  container.querySelectorAll(".btn-salvar-produto").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const painel = btn.closest(".painel");
      const nome = painel.querySelector(".pe-nome").value.trim();

      if (!nome) {
        mostrarToast("O nome não pode ficar vazio.", "erro");
        return;
      }

      const diasAlertaValor = painel.querySelector(".pe-dias-alerta").value;
      const minimoValor = painel.querySelector(".pe-minimo").value;
      const dados = {
        nome,
        categoria: painel.querySelector(".pe-categoria").value.trim(),
        precoCusto: Number(painel.querySelector(".pe-custo").value) || 0,
        precoVenda: Number(painel.querySelector(".pe-venda").value) || 0,
        codigoBarras: painel.querySelector(".pe-codigo").value.trim(),
        diasAlerta: diasAlertaValor === "" ? null : Number(diasAlertaValor),
        estoqueMinimo: minimoValor === "" ? null : Number(minimoValor),
      };

      btn.disabled = true;
      const textoOriginal = btn.textContent;
      btn.textContent = "Salvando…";

      try {
        await updateDoc(doc(db, "produtos", btn.dataset.id), dados);
        // Se o produto já foi contado no Estoque, mantém o nome igual lá
        // (a página da gerente lê o nome direto do documento de estoque).
        // Se ainda não existe contagem, não há nada para atualizar.
        try {
          await updateDoc(doc(db, "estoque", btn.dataset.id), { produtoNome: nome });
        } catch (e) {
          /* produto ainda sem estoque contado */
        }
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
