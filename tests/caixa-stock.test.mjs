import test from "node:test";
import assert from "node:assert/strict";
import { calcularBaixaEstoque } from "../js/caixa-stock.js";

test("baixa uma unidade quando o saldo contado é positivo", () => {
  assert.deepEqual(calcularBaixaEstoque(4, true), {
    atualizar: true, antes: 4, depois: 3, divergencia: false,
  });
});

test("não cria saldo negativo quando o saldo contado é zero", () => {
  assert.deepEqual(calcularBaixaEstoque(0, true), {
    atualizar: false, antes: 0, depois: 0, divergencia: true,
  });
});

test("saldo ausente permanece não contado e não é criado pela venda", () => {
  assert.deepEqual(calcularBaixaEstoque(null, false), {
    atualizar: false, antes: null, depois: null, divergencia: false,
  });
});

test("saldo negativo preexistente é tratado como zero para novas baixas", () => {
  assert.deepEqual(calcularBaixaEstoque(-2, true), {
    atualizar: false, antes: 0, depois: 0, divergencia: true,
  });
});
