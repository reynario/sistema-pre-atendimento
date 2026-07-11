import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFreeSlots, overlaps, toMin } from "../src/core/slots-engine.js";

// Dia fixo para os testes (horário local)
const DAY = new Date("2026-08-10T00:00:00");
const at = (hhmm: string) => new Date(DAY.getTime() + toMin(hhmm) * 60 * 1000);
const PAST = new Date(0); // minStart no passado = sem restrição de antecedência

test("janela de 9h às 12h com serviço de 30min gera slots a cada 15min", () => {
  const slots = computeFreeSlots({
    dayStart: DAY,
    rules: [{ startTime: "09:00", endTime: "12:00" }],
    busy: [],
    durationMin: 30,
    minStart: PAST,
  });
  // Último início possível: 11:30 (30min cabem até 12:00) => 09:00..11:30 de 15 em 15
  assert.equal(slots.length, 11);
  assert.equal(new Date(slots[0].startsAt).getHours(), 9);
  const last = new Date(slots[slots.length - 1].startsAt);
  assert.equal(`${last.getHours()}:${last.getMinutes()}`, "11:30");
});

test("serviço não pode estourar o fim da janela", () => {
  const slots = computeFreeSlots({
    dayStart: DAY,
    rules: [{ startTime: "09:00", endTime: "10:00" }],
    busy: [],
    durationMin: 45,
    minStart: PAST,
  });
  // 09:00 e 09:15 cabem (terminam 09:45 e 10:00); 09:30 estouraria
  assert.deepEqual(
    slots.map((s) => new Date(s.startsAt).getMinutes()),
    [0, 15],
  );
});

test("agendamento existente bloqueia os slots que sobrepõem", () => {
  const slots = computeFreeSlots({
    dayStart: DAY,
    rules: [{ startTime: "09:00", endTime: "11:00" }],
    busy: [{ startsAt: at("09:30"), endsAt: at("10:00") }],
    durationMin: 30,
    minStart: PAST,
  });
  const starts = slots.map((s) => {
    const d = new Date(s.startsAt);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  // 09:00 termina 09:30 (encosta, ok); 09:15/09:30/09:45 sobrepõem; 10:00+ ok
  assert.deepEqual(starts, ["09:00", "10:00", "10:15", "10:30"]);
});

test("encostar nas bordas de um horário ocupado não é conflito", () => {
  // 10:00-10:30 ocupado; slot que TERMINA 10:00 e slot que COMEÇA 10:30 são válidos
  assert.equal(overlaps(at("09:30"), at("10:00"), at("10:00"), at("10:30")), false);
  assert.equal(overlaps(at("10:30"), at("11:00"), at("10:00"), at("10:30")), false);
  assert.equal(overlaps(at("09:45"), at("10:15"), at("10:00"), at("10:30")), true);
});

test("antecedência mínima corta os slots anteriores a minStart", () => {
  const slots = computeFreeSlots({
    dayStart: DAY,
    rules: [{ startTime: "09:00", endTime: "12:00" }],
    busy: [],
    durationMin: 30,
    minStart: at("10:30"),
  });
  assert.ok(slots.every((s) => new Date(s.startsAt) >= at("10:30")));
  assert.equal(new Date(slots[0].startsAt).getHours(), 10);
  assert.equal(new Date(slots[0].startsAt).getMinutes(), 30);
});

test("janelas sobrepostas não geram slots duplicados e a saída é ordenada", () => {
  const slots = computeFreeSlots({
    dayStart: DAY,
    rules: [
      { startTime: "10:00", endTime: "12:00" },
      { startTime: "09:00", endTime: "11:00" },
    ],
    busy: [],
    durationMin: 60,
    minStart: PAST,
  });
  const keys = slots.map((s) => s.startsAt);
  assert.equal(new Set(keys).size, keys.length, "sem duplicatas");
  assert.deepEqual(keys, [...keys].sort(), "ordenado");
  // 09:00..10:00 (da 2ª janela) e 10:00..11:00 (da 1ª) => 09:00 até 11:00 de 15/15
  assert.equal(slots.length, 9);
});

test("sem regras não há slots; bloqueio de dia inteiro zera a agenda", () => {
  assert.equal(
    computeFreeSlots({ dayStart: DAY, rules: [], busy: [], durationMin: 30, minStart: PAST }).length,
    0,
  );
  const blockedDay = computeFreeSlots({
    dayStart: DAY,
    rules: [{ startTime: "08:00", endTime: "18:00" }],
    busy: [{ startsAt: at("00:00"), endsAt: at("23:59") }],
    durationMin: 30,
    minStart: PAST,
  });
  assert.equal(blockedDay.length, 0);
});

test("duração maior que a janela não gera slot", () => {
  const slots = computeFreeSlots({
    dayStart: DAY,
    rules: [{ startTime: "09:00", endTime: "09:30" }],
    busy: [],
    durationMin: 60,
    minStart: PAST,
  });
  assert.equal(slots.length, 0);
});
