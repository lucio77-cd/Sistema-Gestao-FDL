import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  query,
  where,
  limit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

async function obterEstabelecimento(uid) {
  const ref = collection(db, "estabelecimentos");
  const q = query(ref, where("ownerId", "==", uid), limit(2));
  const snap = await getDocs(q);

  if (snap.empty) {
    const erro = new Error(
      "Nenhum estabelecimento foi encontrado para esta conta. Por segurança, o sistema não criará outro automaticamente, pois isso pode ocultar os dados de um estabelecimento já existente. Verifique o vínculo ownerId/UID antes de qualquer criação."
    );
    erro.code = "estabelecimento/nao-encontrado";
    throw erro;
  }

  if (snap.size > 1) {
    const erro = new Error(
      "Mais de um estabelecimento está vinculado a esta conta. O carregamento foi interrompido para evitar selecionar o estabelecimento errado."
    );
    erro.code = "estabelecimento/vinculo-duplicado";
    throw erro;
  }

  const estabelecimentoDoc = snap.docs[0];
  return { id: estabelecimentoDoc.id, ...estabelecimentoDoc.data() };
}

export function protegerPagina(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      const destino = `${window.location.pathname}${window.location.search}`;
      window.location.href = `login.html?returnTo=${encodeURIComponent(destino)}`;
      return;
    }
    try {
      const estabelecimento = await obterEstabelecimento(user.uid);
      await callback({ user, estabelecimento });
    } catch (erro) {
      console.error("Falha ao carregar a página:", erro);
      mostrarErroCarregamento(erro);
    }
  });
}

function mostrarErroCarregamento(erro) {
  const main = document.querySelector("main");
  if (!main) return;

  main.querySelector("[data-erro-carregamento]")?.remove();

  const painel = document.createElement("section");
  painel.className = "painel";
  painel.dataset.erroCarregamento = "true";
  painel.style.borderColor = "var(--vencido)";

  const titulo = document.createElement("h2");
  titulo.style.marginTop = "0";
  titulo.style.color = "var(--vencido)";
  titulo.textContent = "Não foi possível carregar";

  const descricao = document.createElement("p");
  descricao.className = "legenda";
  descricao.textContent = "O sistema interrompeu o carregamento para proteger os dados existentes.";

  const detalhe = document.createElement("pre");
  detalhe.className = "rodape-token";
  detalhe.style.whiteSpace = "pre-wrap";
  detalhe.textContent = (erro && erro.message) || String(erro);

  painel.append(titulo, descricao, detalhe);
  main.prepend(painel);
}

export async function sair() {
  await signOut(auth);
  window.location.href = "login.html";
}
