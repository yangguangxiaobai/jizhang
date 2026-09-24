import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_TOOL_NAMES,
  isAssistantToolName,
  normalizeAssistantContent,
  normalizeAssistantJson,
  requireAssistantToolName,
  AssistantValidationError,
} from '../src/services/assistant-types.js';
import { AssistantToolRegistry } from '../src/services/assistant-tool-registry.js';

describe('assistant JSON contract', () => {
  it('keeps decimals used by ratios, weights, and confidence', () => {
    const normalized = normalizeAssistantJson({
      ratio: 0.4,
      weight: 0.35,
      confidence: 0.875,
      nested: { share: 0.125, list: [0.5, 1.25] },
    }) as Record<string, unknown>;

    expect(normalized['ratio']).toBe(0.4);
    expect(normalized['weight']).toBe(0.35);
    expect(normalized['confidence']).toBe(0.875);
    expect((normalized['nested'] as Record<string, unknown>)['share']).toBe(0.125);
    expect((normalized['nested'] as Record<string, unknown>)['list']).toEqual([0.5, 1.25]);
  });

  it('still rejects non-finite numbers and unsafe large integers', () => {
    expect(() => normalizeAssistantJson({ value: Number.NaN })).toThrow(AssistantValidationError);
    expect(() => normalizeAssistantJson({ value: Number.POSITIVE_INFINITY })).toThrow(AssistantValidationError);
    expect(() => normalizeAssistantJson({ value: Number.MAX_SAFE_INTEGER + 2 })).toThrow(AssistantValidationError);
  });
});

describe('assistant progress / error / toolName', () => {
  it('accepts a known tool name on progress and rejects unknown names', () => {
    const ok = normalizeAssistantContent('progress', {
      version: 1,
      progress: { state: 'running', toolName: 'stats.monthly' },
    });
    expect(ok.progress?.toolName).toBe('stats.monthly');

    expect(() =>
      normalizeAssistantContent('progress', {
        version: 1,
        progress: { state: 'running', toolName: 'not-a-tool' },
      }),
    ).toThrow(AssistantValidationError);

    expect(() =>
      normalizeAssistantContent('progress', {
        version: 1,
        progress: { state: 'running', toolName: 42 },
      }),
    ).toThrow(AssistantValidationError);
  });

  it('validates result toolName against the allowlist', () => {
    const ok = normalizeAssistantContent('result', {
      version: 1,
      result: { version: 1, toolName: 'accounts.balances', summary: 'ok', data: { total: 1 } },
    });
    expect(ok.result?.toolName).toBe('accounts.balances');

    expect(() =>
      normalizeAssistantContent('result', {
        version: 1,
        result: { version: 1, toolName: 'injected.tool', summary: 'ok', data: {} },
      }),
    ).toThrow(AssistantValidationError);
  });

  it('requires a structured error payload', () => {
    const ok = normalizeAssistantContent('error', {
      version: 1,
      error: { code: 'AI_UNAVAILABLE', message: 'AI 暂不可用' },
    });
    expect(ok.error).toEqual({ code: 'AI_UNAVAILABLE', message: 'AI 暂不可用' });

    expect(() =>
      normalizeAssistantContent('error', { version: 1, error: 'boom' }),
    ).toThrow(AssistantValidationError);
    expect(() =>
      normalizeAssistantContent('error', { version: 1, error: { code: 'X' } }),
    ).toThrow(AssistantValidationError);
  });

  it('requireAssistantToolName rejects non-allowlisted values', () => {
    expect(requireAssistantToolName('transaction.create', 'toolName')).toBe('transaction.create');
    expect(() => requireAssistantToolName('drop table', 'toolName')).toThrow(AssistantValidationError);
    expect(() => requireAssistantToolName(undefined, 'toolName')).toThrow(AssistantValidationError);
  });
});

describe('assistant tool catalog', () => {
  it('registers every allowlisted tool and never shrinks the catalog', () => {
    const registry = new AssistantToolRegistry();
    const catalog = registry.catalog();
    const names = catalog.map((tool) => tool.name);

    expect(names).toEqual([...ASSISTANT_TOOL_NAMES]);
    expect(new Set(names).size).toBe(ASSISTANT_TOOL_NAMES.length);
    for (const name of ASSISTANT_TOOL_NAMES) {
      expect(isAssistantToolName(name)).toBe(true);
      expect(registry.get(name)).toBeDefined();
    }
  });
});
