import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/client.js', () => ({ getDb: vi.fn() }));
vi.mock('../subscriptions/plan.service.js', () => ({ assertFeature: vi.fn() }));
vi.mock('../../core/events.js', () => ({ emitEvent: vi.fn() }));
vi.mock('../ai/ai.service.js', () => ({ aiProviderComplete: vi.fn() }));

let parseWorkflowDefinition: typeof import('./workflow.engine.js')['parseWorkflowDefinition'];
let prepareWorkflowButtons: typeof import('./workflow.engine.js')['prepareWorkflowButtons'];

beforeAll(async () => {
  ({ parseWorkflowDefinition, prepareWorkflowButtons } = await import('./workflow.engine.js'));
});

describe('workflow definition parser', () => {
  it('accepts supported steps and strips malformed children without crashing', () => {
    const def = parseWorkflowDefinition({
      trigger: { kind: 'MESSAGE_RECEIVED', keyword: 'سلام' },
      steps: [
        { type: 'MESSAGE', text: 'سلام {{name}}' },
        { type: 'BUTTONS', text: 'انتخاب کنید', buttons: [{ label: 'راهنما', url: 'https://postyarhub.ir/help' }] },
        { type: 'CONDITION', variable: 'text', operator: 'CONTAINS', value: 'قیمت', then: [{ type: 'MESSAGE', text: 'قیمت امروز' }, { nope: true }] },
        { nope: true },
      ],
    });
    expect(def).not.toBeNull();
    expect(def?.steps).toHaveLength(3);
    expect(def?.steps[0]).toEqual({ type: 'MESSAGE', text: 'سلام {{name}}' });
    expect(def?.steps[2]?.type).toBe('CONDITION');
  });


  it('preserves callback buttons for workflow sends and drops unusable entries', () => {
    expect(prepareWorkflowButtons([
      { label: 'URL', url: 'https://postyarhub.ir' },
      { label: 'Callback', callback: 'PLAN_BASIC' },
      { label: 'Empty' },
    ])).toEqual([
      { label: 'URL', url: 'https://postyarhub.ir' },
      { label: 'Callback', callback: 'PLAN_BASIC' },
    ]);
  });

  it('rejects a workflow with no valid executable steps', () => {
    expect(parseWorkflowDefinition({ trigger: { kind: 'MESSAGE_RECEIVED' }, steps: [{ nope: true }] })).toBeNull();
    expect(parseWorkflowDefinition(null)).toBeNull();
  });
});
