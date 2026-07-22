/**
 * Tests for the recall escalation store (#480, persistence consolidation #579).
 *
 * Verifies the CRUD/workflow API is preserved after migrating the module-level
 * `Map` to the shared KV repository, and that state is read back from the store
 * (not just a returned reference).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { __resetStores } from '@/lib/store';
import {
  createEscalation,
  advanceEscalation,
  getEscalation,
  listEscalations,
  addNotifiedStakeholder,
  nextStage,
  isTerminalStage,
  buildStakeholderNotification,
} from '@/lib/recall/escalation';

function makeEscalation(productId = 'prod-1') {
  return createEscalation({
    productId,
    productName: 'Coffee Beans',
    reason: 'contamination',
    priority: 'high',
    initiatedBy: 'GADMIN',
  });
}

describe('recall escalation store', () => {
  beforeEach(() => {
    __resetStores();
  });

  it('createEscalation persists a record readable via getEscalation', () => {
    const esc = makeEscalation();
    expect(esc.stage).toBe('initiated');
    expect(getEscalation(esc.id)).toEqual(esc);
  });

  it('getEscalation returns null for an unknown id', () => {
    expect(getEscalation('missing')).toBeNull();
  });

  it('advanceEscalation persists each stage transition and audit trail', () => {
    const esc = makeEscalation();
    const advanced = advanceEscalation(esc.id, 'GREVIEWER', 'moving to review');
    expect(advanced?.stage).toBe('under_review');

    // Re-read from the store to prove the transition persisted.
    const stored = getEscalation(esc.id)!;
    expect(stored.stage).toBe('under_review');
    expect(stored.auditTrail).toHaveLength(2);
    expect(stored.auditTrail[1]).toMatchObject({
      stage: 'under_review',
      actor: 'GREVIEWER',
      note: 'moving to review',
    });
  });

  it('advanceEscalation walks through to resolved and stops', () => {
    const esc = makeEscalation();
    // initiated -> under_review -> stakeholders_notified -> regulatory_filed -> resolved
    for (let i = 0; i < 4; i++) {
      advanceEscalation(esc.id, 'GACTOR');
    }
    const stored = getEscalation(esc.id)!;
    expect(stored.stage).toBe('resolved');
    expect(stored.resolvedAt).toBeTypeOf('number');
    expect(isTerminalStage(stored.stage)).toBe(true);

    // A terminal escalation cannot advance further.
    expect(advanceEscalation(esc.id, 'GACTOR')).toBeNull();
  });

  it('advanceEscalation returns null for an unknown id', () => {
    expect(advanceEscalation('missing', 'GACTOR')).toBeNull();
  });

  it('addNotifiedStakeholder persists and de-duplicates', () => {
    const esc = makeEscalation();
    addNotifiedStakeholder(esc.id, 'alice');
    addNotifiedStakeholder(esc.id, 'alice');
    addNotifiedStakeholder(esc.id, 'bob');
    expect(getEscalation(esc.id)!.notifiedStakeholders).toEqual(['alice', 'bob']);
  });

  it('listEscalations filters by productId', () => {
    const a = makeEscalation('prod-a');
    const b = makeEscalation('prod-b');
    expect(
      listEscalations()
        .map((e) => e.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());
    expect(listEscalations('prod-a')).toHaveLength(1);
    expect(listEscalations('prod-a')[0].id).toBe(a.id);
  });

  it('helpers: nextStage and buildStakeholderNotification are unchanged', () => {
    expect(nextStage('initiated')).toBe('under_review');
    expect(nextStage('resolved')).toBeNull();

    const esc = makeEscalation();
    const note = buildStakeholderNotification(esc);
    expect(note).toMatchObject({
      stage: 'initiated',
      priority: 'high',
      productId: 'prod-1',
      escalationId: esc.id,
    });
    expect(note.timestamp).toBeTypeOf('string');
  });
});
