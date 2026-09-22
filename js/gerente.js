import { db } from "./firebase-config.js";
import {
  calcularStatus,
  formatarDiasRestantes,
  calcularResumoGerente,
  sugestaoAcao,
  STATUS_ICONE,
  montarGraficoPorProduto,
  calcularPercentuaisEstoque,
  escapeHtml,
} from "./status.js";
import {
  collection,
  query,
  where,
  limit,
  getDocs,
  doc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { mostrarToast } from "./toast.js";

let todosLotes = [];
let lotesUrgentes = [];
let graficoAtual = null;
const filtroPeriodo = document.getElementById("filtro-periodo");
const filtroEstoqueLocal = document.getElementById("filtro-estoque-local");

const segVencimentos = document.getElementById("seg-vencimentos");
const segEstoque = document.getElementById("seg-estoque");
const secaoVencimentos = document.getElementById("secao-vencimentos");
const secaoEstoque = document.getElementById("secao-estoque");

function mostrarAba(nome) {
  const ehVencimentos = nome === "vencimentos";
  secaoVencimentos.hidden = !ehVencimentos;
  secaoEstoque.hidden = ehVencimentos;
  segVencimentos.classList.toggle("ativo", ehVencimentos);
  segVencimentos.setAttribute("aria-selected", String(ehVencimentos));
  segEstoque.classList.toggle("ativo", !ehVencimentos);
  segEstoque.setAttribute("aria-selected", String(!ehVencimentos));

  if (!ehVencimentos) renderizarEstoque();
}

segVencimentos.addEventListener("click", () => mostrarAba("vencimentos"));
segEstoque.addEventListener("click", () => mostrarAba("estoque"));
filtroEstoqueLocal.addEventListener("change", renderizarEstoque);

async function iniciar() {
  try {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) return mostrarErro();

    const snapEstab = await getDocs(
      query(collection(db, "estabelecimentos"), where("linkToken", "==", token), limit(1))
    );
    if (snapEstab.empty) return mostrarErro();

    const estabelecimento = { id: snapEstab.docs[0].id, ...snapEstab.docs[0].data() };
    document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;
    renderizarAtualizacao(estabelecimento.ultimaVistoria);

    const diasAlertaPadrao = estabelecimento.diasAlertaPadrao ?? 3;

    const lotesSnap = await getDocs(
      query(collection(db, "lotes"), where("estabelecimentoId", "==", estabelecimento.id))
    );

    if (lotesSnap.empty) {
      document.getElementById("lista-lotes").innerHTML =
        '<p class="mensagem-vazio">Nenhum dado encontrado ainda.</p>';
      document.getElementById("tabela-estoque").innerHTML =
        '<p class="mensagem-vazio">Nenhum dado encontrado ainda.</p>';
      document.getElementById("resumo").hidden = true;
      return;
    }

    todosLotes = lotesSnap.docs.map((d) => {
      const dados = d.data();
      const diasAlerta = dados.diasAlerta ?? diasAlertaPadrao;
      const { diasRestantes, status } = calcularStatus(dados.dataVencimento, diasAlerta, dados.promocaoAtiva);
      return { id: d.id, ...dados, produtoNome: dados.produtoNome || "Produto", diasRestantes, status };
    });

    lotesUrgentes = todosLotes.filter((l) => l.status !== "normal").sort((a, b) => a.diasRestantes - b.diasRestantes);

    renderizarResumo(lotesUrgentes);
    renderizarLista(lotesUrgentes);

    if (lotesUrgentes.length > 0) {
      document.getElementById("bloco-grafico").hidden = false;
      renderizarGrafico();
      filtroPeriodo.addEventListener("change", renderizarGrafico);
    }
  } catch (erro) {
    console.error(erro);
    mostrarErro("Não foi possível carregar os dados agora. Tente atualizar a página em instantes.");
  }
}

function renderizarGrafico() {
  const periodo = Number(filtroPeriodo.value);
  const lotesNoPeriodo = lotesUrgentes.filter((l) => l.diasRestantes <= periodo);

  if (graficoAtual) {
    graficoAtual.destroy();
    graficoAtual = null;
  }

  const canvas = document.getElementById("grafico-vencimentos");
  const semDados = document.getElementById("grafico-sem-dados");

  if (lotesNoPeriodo.length === 0) {
    canvas.hidden = true;
    semDados.hidden = false;
    semDados.textContent = "Nenhum dado neste período.";
    return;
  }

  canvas.hidden = false;
  semDados.hidden = true;
  const { chart } = montarGraficoPorProduto(canvas, lotesNoPeriodo);
  graficoAtual = chart;
}

function renderizarEstoque() {
  const local = filtroEstoqueLocal.value;
  const container = document.getElementById("tabela-estoque");

  const percentuais = calcularPercentuaisEstoque(todosLotes);
  const linhas =
    local === "todos"
      ? percentuais
      : percentuais
          .map((p) => ({ ...p, quantidade: p.local[local] || 0 }))
          .filter((p) => p.quantidade > 0);

  if (linhas.length === 0) {
    container.innerHTML = '<p class="mensagem-vazio">Nada neste local no momento.</p>';
    return;
  }

  container.innerHTML = linhas
    .map(
      (p) => `
        <div class="linha-estoque">
          <div class="linha-estoque-nome">${escapeHtml(p.produtoNome)}</div>
          <div class="linha-estoque-qtd">${p.quantidade} un.</div>
          <div class="linha-estoque-pct">${p.percentual.toFixed(1)}%</div>
        </div>
      `
    )
    .join("");
}

function renderizarResumo(lotes) {
  const resumo = calcularResumoGerente(lotes);
  const el = document.getElementById("resumo");
  el.hidden = false;
  el.className = `resumo resumo--${resumo.status}`;
  document.getElementById("resumo-numero").textContent =
    resumo.numero !== null ? resumo.numero : "✓";
  document.getElementById("resumo-texto").textContent = resumo.texto;
}

function renderizarAtualizacao(ultimaVistoria) {
  const el = document.getElementById("legenda-atualizacao");
  if (!ultimaVistoria) {
    el.textContent = "Nenhuma vistoria registrada ainda.";
    return;
  }
  const data = ultimaVistoria.toDate ? ultimaVistoria.toDate() : new Date(ultimaVistoria);
  el.textContent = `Atualizado pela última vez em ${data.toLocaleDateString("pt-BR")} às ${data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

function renderizarLista(lotes) {
  const container = document.getElementById("lista-lotes");
  container.innerHTML = "";

  if (lotes.length === 0) {
    container.innerHTML = '<p class="mensagem-vazio">Nada em atenção ou vencido no momento.</p>';
    return;
  }

  lotes.forEach((l) => {
    const div = document.createElement("div");
    div.className = `lote lote--${l.status}`;
    div.innerHTML = `
      <div class="lote-info">
        <div class="lote-produto">${STATUS_ICONE[l.status]} ${escapeHtml(l.produtoNome)}</div>
        <div class="lote-meta">${escapeHtml(l.local || "—")} · ${l.quantidade} un.</div>
        <div class="lote-instrucao lote-dias--${l.status}">${sugestaoAcao(l.status, l.diasRestantes)}</div>
        <div class="lote-preco-venda">
          <label>Valor de venda (R$)</label>
          <input type="number" step="0.01" min="0" class="input-preco-venda" value="${l.precoPromocional ?? ""}" placeholder="Ex: 3.50" />
          <button type="button" class="btn btn-secundario btn-salvar-preco" data-id="${l.id}">Salvar</button>
        </div>
      </div>
      <div class="lote-dados">
        <div class="lote-dias lote-dias--${l.status}">${formatarDiasRestantes(l.diasRestantes)}</div>
      </div>
    `;
    container.appendChild(div);
  });

  container.querySelectorAll(".btn-salvar-preco").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const linha = btn.closest(".lote-preco-venda");
      const input = linha.querySelector(".input-preco-venda");
      const valor = Number(input.value);

      if (!input.value || valor < 0) {
        mostrarToast("Informe um valor válido.", "erro");
        return;
      }

      btn.disabled = true;
      const textoOriginal = btn.textContent;
      btn.textContent = "Salvando…";

      try {
        await updateDoc(doc(db, "lotes", btn.dataset.id), {
          precoPromocional: valor,
          promocaoAtiva: true,
        });
        mostrarToast("Valor de venda salvo.", "ok");
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

function mostrarErro(mensagem) {
  const el = document.getElementById("erro-token");
  el.textContent = mensagem || "Link inválido ou expirado.";
  el.hidden = false;
  document.getElementById("lista-lotes").innerHTML = "";
  document.getElementById("legenda-atualizacao").textContent = "";
}

iniciar();
