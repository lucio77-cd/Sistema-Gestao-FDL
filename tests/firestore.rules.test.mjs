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
    await setDoc(doc(db, "estoque", "produto-a"), { estabelecimentoId: "loja-a", geladeira: 4, seco: 2 });
    await setDoc(doc(db, "vistorias", "vistoria-a"), { estabelecimentoId: "loja-a", itens: [] });
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

test("consulta de lista exige filtro compatível com o estabelecimento do usuário", async () => {
  const dbA = testEnv.authenticatedContext("uid-a").firestore();
  await assertSucceeds(getDocs(query(collection(dbA, "produtos"), where("estabelecimentoId", "==", "loja-a"))));
  await assertFails(getDocs(collection(dbA, "produtos")));
});

test("usuário autenticado pode consultar saldo inexistente sem obter dados de outra loja", async () => {
  const dbA = testEnv.authenticatedContext("uid-a").firestore();
  await assertSucceeds(getDoc(doc(dbA, "estoque", "saldo-ainda-nao-criado")));
  await assertFails(getDoc(doc(dbA, "estoque", "produto-b")));
});

test("histórico de vistoria pode ser lido pelo dono, mas não editado ou excluído", async () => {
  const dbA = testEnv.authenticatedContext("uid-a").firestore();
  const ref = doc(dbA, "vistorias", "vistoria-a");
  await assertSucceeds(getDoc(ref));
  await assertFails(updateDoc(ref, { alterado: true }));
  await assertFails(deleteDoc(ref));
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
