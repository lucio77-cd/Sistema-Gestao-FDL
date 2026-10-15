import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const PROJECT_ID = "demo-sistema-gv-fdl";
let testEnv;

before(async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "estabelecimentos", "loja-a"), { ownerId: "uid-a", nome: "Loja A" });
    await setDoc(doc(db, "estabelecimentos", "loja-b"), { ownerId: "uid-b", nome: "Loja B" });
    await setDoc(doc(db, "produtos", "produto-a"), { estabelecimentoId: "loja-a", nome: "Produto A" });
    await setDoc(doc(db, "produtos", "produto-b"), { estabelecimentoId: "loja-b", nome: "Produto B" });
    await setDoc(doc(db, "lotes", "lote-a"), { estabelecimentoId: "loja-a", produtoId: "produto-a", quantidade: 5 });
    await setDoc(doc(db, "lotes", "lote-b"), { estabelecimentoId: "loja-b", produtoId: "produto-b", quantidade: 5 });
    await setDoc(doc(db, "estoque", "produto-a"), { estabelecimentoId: "loja-a", geladeira: 4, seco: 2 });
    await setDoc(doc(db, "estoque", "produto-b"), { estabelecimentoId: "loja-b", geladeira: 7, seco: 3 });
    await setDoc(doc(db, "vistorias", "vistoria-a"), { estabelecimentoId: "loja-a", itens: [] });
    await setDoc(doc(db, "movimentosEstoque", "movimento-a"), { estabelecimentoId: "loja-a", tipo: "entrada" });
  });
});

after(async () => {
  await testEnv?.cleanup();
});

test("proprietário lê os próprios dados e não lê os dados de outra loja", async () => {
  const dbA = testEnv.authenticatedContext("uid-a").firestore();
  const dbB = testEnv.authenticatedContext("uid-b").firestore();
  await assertSucceeds(getDoc(doc(dbA, "produtos", "produto-a")));
  await assertFails(getDoc(doc(dbA, "produtos", "produto-b")));
  await assertSucceeds(getDoc(doc(dbB, "produtos", "produto-b")));
  await assertFails(getDoc(doc(dbB, "produtos", "produto-a")));
});

test("usuário não pode alterar proprietário do estabelecimento nem acessar outro", async () => {
  const dbA = testEnv.authenticatedContext("uid-a").firestore();
  await assertSucceeds(getDoc(doc(dbA, "estabelecimentos", "loja-a")));
  await assertFails(getDoc(doc(dbA, "estabelecimentos", "loja-b")));
  await assertFails(updateDoc(doc(dbA, "estabelecimentos", "loja-a"), { ownerId: "uid-b" }));
  await assertFails(deleteDoc(doc(dbA, "estabelecimentos", "loja-a")));
});

test("consulta de lista exige filtro compatível com o estabelecimento do usuário", async () => {
  const dbA = testEnv.authenticatedContext("uid-a").firestore();
  await assertSucceeds(getDocs(query(collection(dbA, "produtos"), where("estabelecimentoId", "==", "loja-a"))));
  await assertFails(getDocs(collection(dbA, "produtos")));
});

test("criação e alteração de produtos e lotes respeitam o estabelecimento", async () => {
  const dbA = testEnv.authenticatedContext("uid-a").firestore();
  await assertSucceeds(setDoc(doc(dbA, "produtos", "produto-novo"), {
    estabelecimentoId: "loja-a", nome: "Novo"
  }));
  await assertFails(setDoc(doc(dbA, "produtos", "produto-invasor"), {
    estabelecimentoId: "loja-b", nome: "Invasor"
  }));
  await assertFails(updateDoc(doc(dbA, "produtos", "produto-a"), { estabelecimentoId: "loja-b" }));
  await assertSucceeds(updateDoc(doc(dbA, "lotes", "lote-a"), { quantidade: 4 }));
  await assertFails(updateDoc(doc(dbA, "lotes", "lote-b"), { quantidade: 4 }));
});

test("usuário autenticado pode consultar saldo inexistente sem obter dados de outra loja", async () => {
  const dbA = testEnv.authenticatedContext("uid-a").firestore();
  await assertSucceeds(getDoc(doc(dbA, "estoque", "saldo-ainda-nao-criado")));
  await assertFails(getDoc(doc(dbA, "estoque", "produto-b")));
});

test("históricos de vistoria e movimentação são legíveis, mas não editáveis nem excluíveis", async () => {
  const dbA = testEnv.authenticatedContext("uid-a").firestore();
  const vistoria = doc(dbA, "vistorias", "vistoria-a");
  const movimento = doc(dbA, "movimentosEstoque", "movimento-a");
  await assertSucceeds(getDoc(vistoria));
  await assertSucceeds(getDoc(movimento));
  await assertFails(updateDoc(vistoria, { alterado: true }));
  await assertFails(deleteDoc(vistoria));
  await assertFails(updateDoc(movimento, { alterado: true }));
  await assertFails(deleteDoc(movimento));
});

test("usuário não autenticado não acessa dados protegidos", async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "produtos", "produto-a")));
  await assertFails(getDoc(doc(db, "estoque", "produto-a")));
});

test("dono pode criar saída no próprio estabelecimento, mas não no de outro", async () => {
  const dbA = testEnv.authenticatedContext("uid-a").firestore();
  await assertSucceeds(setDoc(doc(dbA, "saidas", "saida-a"), {
    estabelecimentoId: "loja-a", motivo: "vendido", quantidade: 1
  }));
  await assertFails(setDoc(doc(dbA, "saidas", "saida-b"), {
    estabelecimentoId: "loja-b", motivo: "vendido", quantidade: 1
  }));
});

test("vistoria pode gravar saída e movimento no próprio estabelecimento", async () => {
  const dbA = testEnv.authenticatedContext("uid-a").firestore();
  await assertSucceeds(setDoc(doc(dbA, "vistorias", "vistoria-nova"), {
    estabelecimentoId: "loja-a", itens: [], data: new Date()
  }));
  await assertSucceeds(setDoc(doc(dbA, "movimentosEstoque", "movimento-vencido"), {
    estabelecimentoId: "loja-a", produtoId: "produto-a", tipo: "vencido",
    antes: 2, depois: 0, delta: -2, divergenciaSaldo: true
  }));
  await assertFails(setDoc(doc(dbA, "movimentosEstoque", "movimento-outra-loja"), {
    estabelecimentoId: "loja-b", produtoId: "produto-b", tipo: "vencido"
  }));
});

test("gerente autenticada do estabelecimento pode atualizar promoção, mas não acessar outra loja", async () => {
  const dbA = testEnv.authenticatedContext("uid-a").firestore();
  await assertSucceeds(updateDoc(doc(dbA, "lotes", "lote-a"), {
    promocaoAtiva: true, precoPromocional: 2.5
  }));
  await assertFails(updateDoc(doc(dbA, "lotes", "lote-b"), {
    promocaoAtiva: true, precoPromocional: 2.5
  }));
});
