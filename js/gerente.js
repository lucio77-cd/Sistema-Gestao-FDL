import { db } from "./firebase-config.js";
import { calcularStatus, formatarDiasRestantes, calcularResumoGerente, sugestaoAcao, STATUS_ICONE } from "./status.js";
import {
  collection,
  query,
  where,
  limit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Esta página não tem login (acesso via token na URL). Por isso ela nunca
// consulta a coleção "produtos" (restrita, tem preço de custo) — o nome e a
// antecedência de alerta de cada lote já vêm gravados no próprio documento
// do lote (ver vistoria.js). Isso evita "permissão negada" travando a
// página em "Carregando…" para sempre.

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

    const lotes = lotesSnap.docs
      .map((d) => {
        const dados = d.data();
        const diasAlerta = dados.diasAlerta ?? diasAlertaPadrao;
        const { diasRestantes, status } = calcularStatus(dados.dataVencimento, diasAlerta, dados.promocaoAtiva);
        return { ...dados, produtoNome: dados.produtoNome || "Produto", diasRestantes, status };
      })
      .filter((l) => l.status !== "normal")
      .sort((a, b) => a.diasRestantes - b.diasRestantes);

    renderizarResumo(lotes);
    renderizarLista(lotes);
  } catch (erro) {
    console.error(erro);
    mostrarErro("Não foi possível carregar os dados agora. Tente atualizar a página em instantes.");
  }
}

// Cartão-resumo: uma frase e um número, pensados para leitura de 5 segundos
// sem precisar interpretar tabela — a decisão certa para quem não tem
// contexto do sistema e pode nem chegar a abrir esta página com frequência.
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
        <div class="lote-produto">${STATUS_ICONE[l.status]} ${l.produtoNome}</div>
        <div class="lote-meta">${l.local || "—"} · ${l.quantidade} un.</div>
        <div class="lote-instrucao lote-dias--${l.status}">${sugestaoAcao(l.status, l.diasRestantes)}</div>
      </div>
      <div class="lote-dados">
        <div class="lote-dias lote-dias--${l.status}">${formatarDiasRestantes(l.diasRestantes)}</div>
      </div>
    `;
    container.appendChild(div);
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
