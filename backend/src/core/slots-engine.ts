/**
 * Núcleo puro do motor de horários — sem banco, sem I/O. É a parte onde um
 * bug silencioso custa caro (IA oferecendo horário errado), então é a parte
 * coberta por testes automatizados (test/slots-engine.test.ts).
 */

export type FreeSlot = { startsAt: string; endsAt: string };
export type RuleWindow = { startTime: string; endTime: string };
export type BusyInterval = { startsAt: Date; endsAt: Date };

export const SLOT_STEP_MIN = 15;

/** "08:00" -> minutos desde 00:00 */
export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Gera os horários livres de um dia:
 * - dentro das janelas das regras (o serviço precisa CABER até o fim da janela)
 * - sem sobrepor agendamentos/bloqueios (toque nas bordas é permitido)
 * - nunca antes de minStart (antecedência mínima)
 * - sem duplicatas (janelas sobrepostas), ordenados
 */
export function computeFreeSlots(params: {
  dayStart: Date;
  rules: RuleWindow[];
  busy: BusyInterval[];
  durationMin: number;
  minStart: Date;
  stepMin?: number;
}): FreeSlot[] {
  const { dayStart, rules, busy, durationMin, minStart } = params;
  const step = params.stepMin ?? SLOT_STEP_MIN;

  const slots: FreeSlot[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    const ruleStart = toMin(rule.startTime);
    const ruleEnd = toMin(rule.endTime);
    for (let m = ruleStart; m + durationMin <= ruleEnd; m += step) {
      const start = new Date(dayStart.getTime() + m * 60 * 1000);
      const end = new Date(start.getTime() + durationMin * 60 * 1000);
      if (start < minStart) continue;
      if (busy.some((b) => overlaps(start, end, b.startsAt, b.endsAt))) continue;
      const key = start.toISOString();
      if (seen.has(key)) continue;
      seen.add(key);
      slots.push({ startsAt: key, endsAt: end.toISOString() });
    }
  }

  slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return slots;
}
