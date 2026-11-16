import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

iniciarNavegacao();

let movimentos = [];
const lista = document.getElementById("lista-movimentacoes");
const filtroTipo = document.getElementById("filtro-tipo");
const filtroLocal = document.getElementById("filtro-local");
const busca = document.getElementById("busca-movimentacao");
const resumo = document.getElementById("resumo-movimentacoes");

const ROTULOS = {
  entrada: "Entrada",
  venda: "Venda",
  perda: "Perda",
  vencido: "Vencimento",
  ajuste: "Ajuste",
  contagem: "Contagem física",
  importacao: "Importação inicial",
  transferencia_saida: "Transferência — saída",
  transferencia_entrada: "Transferência — entrada"
};
const LOCAIS = { geladeira: "Geladeira", seco: "Parte seca", ambos: "Ambos / geral" };

function esc(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, caractere => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[caractere]));
}
function dataMillis(valor) {
  if (!valor) return 0;
  if (typeof valor.toMillis === "function") return valor.toMillis();
  if (valor instanceof Date) return valor.getTime();
  if (typeof valor === "string" || typeof valor === "number") {
    const data = new Date(valor);
    return Number.isNaN(data.getTime()) ? 0 : data.getTime();
  }
  return 0;
}
function formatarData(valor) {
  const ms = dataMillis(valor);
  return ms ? new Date(ms).toLocaleString("pt-BR", { dateStyle:"short", timeStyle:"short" }) : "Data não informada";
}
function detalheQuantidade(movimento) {
  if (movimento.tipo === "importacao") {
    return "Geladeira: " + (Number(movimento.geladeira) || 0) + " · Parte seca: " + (Number(movimento.seco) || 0);
  }
  const delta = Number(movimento.delta);
  if (Number.isFinite(delta)) return (delta > 0 ? "+" : "") + delta + " un.";
  const quantidade = Number(movimento.quantidade);
  return Number.isFinite(quantidade) ? quantidade + " un." : "—";
}
function detalheLocal(movimento) {
  if (movimento.tipo === "transferencia_saida" || movimento.tipo === "transferencia_entrada") {
    const origem = LOCAIS[movimento.deLocal] || movimento.deLocal || "—";
    const destino = LOCAIS[movimento.paraLocal] || movimento.paraLocal || "—";
    return origem + " → " + destino;
  }
  return LOCAIS[movimento.local] || movimento.local || "—";
}
function preencherTipos() {
  const tipos = [...new Set(movimentos.map(m => m.tipo).filter(Boolean))]
    .sort((a,b) => String(ROTULOS[a] || a).localeCompare(String(ROTULOS[b] || b), "pt-BR"));
  tipos.forEach(tipo => filtroTipo.add(new Option(ROTULOS[tipo] || tipo, tipo)));
}
function renderizar() {
  const termo = busca.value.trim().toLocaleLowerCase("pt-BR");
  const filtrados = movimentos.filter(m => {
    if (filtroTipo.value && m.tipo !== filtroTipo.value) return false;
    if (filtroLocal.value) {
      const locais = [m.local, m.deLocal, m.paraLocal].filter(Boolean);
      if (filtroLocal.value === "ambos") {
        if (!["ambos", "geral"].includes(m.local)) return false;
      } else if (!locais.includes(filtroLocal.value)) return false;
    }
    const texto = [m.produtoNome, m.tipo, ROTULOS[m.tipo], m.local, m.deLocal, m.paraLocal, m.origem]
      .filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
    return !termo || texto.includes(termo);
  }).sort((a,b) => dataMillis(b.registradoEm || b.criadoEm) - dataMillis(a.registradoEm || a.criadoEm));

  resumo.textContent = filtrados.length + " de " + movimentos.length + " registro(s) · Mais recentes primeiro.";
  if (!filtrados.length) {
    lista.innerHTML = '<div class="painel"><p class="mensagem-vazio">Nenhuma movimentação corresponde aos filtros selecionados.</p></div>';
    return;
  }
  lista.innerHTML = filtrados.map(m => {
    const delta = Number(m.delta);
    const classe = Number.isFinite(delta) && delta < 0 ? "selo--atencao" : "selo--normal";
    const quantidade = detalheQuantidade(m);
    const origem = m.origem ? "Origem: " + m.origem : "";
    const sessao = m.sessaoId ? " · Vistoria " + m.sessaoId.slice(0,8) : "";
    return '<article class="painel stock-item"><div class="stock-item-head"><div><strong>' +
      esc(m.produtoNome || "Movimentação sem produto") + '</strong><small>' +
      esc(ROTULOS[m.tipo] || m.tipo || "Movimentação") + " · " + esc(detalheLocal(m)) +
      '</small></div><span class="selo ' + classe + '">' + esc(quantidade) +
      '</span></div><div class="stock-item-meta">' + esc(formatarData(m.registradoEm || m.criadoEm)) +
      (origem ? " · " + esc(origem) : "") + esc(sessao) + '</div></article>';
  }).join("");
}

protegerPagina(async ({ estabelecimento }) => {
  document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;
  lista.innerHTML = '<div class="painel"><p class="mensagem-vazio">Carregando movimentações…</p></div>';
  try {
    const snap = await getDocs(query(
      collection(db, "movimentosEstoque"),
      where("estabelecimentoId", "==", estabelecimento.id)
    ));
    movimentos = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    preencherTipos();
    renderizar();
  } catch (erro) {
    console.error("Falha ao carregar movimentações:", erro);
    resumo.textContent = "Histórico indisponível.";
    lista.innerHTML = '<div class="painel"><p class="mensagem-vazio">Não foi possível consultar as movimentações. Verifique a conexão e a permissão de leitura da coleção movimentosEstoque.</p></div>';
  }
});

filtroTipo.addEventListener("change", renderizar);
filtroLocal.addEventListener("change", renderizar);
busca.addEventListener("input", renderizar);
