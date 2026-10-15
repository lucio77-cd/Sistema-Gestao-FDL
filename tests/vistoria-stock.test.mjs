import test from "node:test";
import assert from "node:assert/strict";
import { calcularBaixaPorVencimento } from "../js/vistoria-stock.js";

test("desconta normalmente quando o saldo cobre o vencimento", () => {
  assert.deepEqual(calcularBaixaPorVencimento(8, 3, true), {
    atualizar: true, antes: 8, depois: 5, delta: -3, divergencia: false,
  });
});

test("preserva zero e sinaliza divergência quando a quantidade excede o saldo", () => {
  assert.deepEqual(calcularBaixaPorVencimento(2, 5, true), {
    atualizar: true, antes: 2, depois: 0, delta: -2, divergencia: true,
  });
});

test("saldo já zerado não fica negativo e sinaliza divergência", () => {
  assert.deepEqual(calcularBaixaPorVencimento(0, 1, true), {
    atualizar: false, antes: 0, depois: 0, delta: 0, divergencia: true,
  });
});

test("saldo inexistente não é inventado nem atualizado", () => {
  assert.deepEqual(calcularBaixaPorVencimento(null, 4, false), {
    atualizar: false, antes: null, depois: null, delta: 0, divergencia: false,
  });
});

test("saldo legado negativo é normalizado para zero sem aprofundar o negativo", () => {
  assert.deepEqual(calcularBaixaPorVencimento(-2, 1, true), {
    atualizar: true, antes: 0, depois: 0, delta: 0, divergencia: true,
  });
});

test("baixas sucessivas de lotes do mesmo produto acumulam sem saldo negativo", () => {
  const primeira = calcularBaixaPorVencimento(4, 3, true);
  const segunda = calcularBaixaPorVencimento(primeira.depois, 2, true);
  assert.equal(primeira.depois, 1);
  assert.equal(segunda.depois, 0);
  assert.equal(segunda.delta, -1);
  assert.equal(segunda.divergencia, true);
});
