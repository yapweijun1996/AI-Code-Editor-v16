/**
 * LLM Debug/QA Harness
 * Lightweight, UI-invokable smoke tests for the provider layer, breaker, and stream paths.
 */

import { ChatService } from '../chat_service.js';

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function ensureService() {
  try {
    if (!ChatService.llmService) {
      // Initialize using existing settings; safe to call multiple times
      await ChatService._initializeLLMService();
    }
    return !!ChatService.llmService;
  } catch (e) {
    console.warn('[Harness] Failed to ensure service:', e);
    return false;
  }
}

/**
 * Trip breaker -> verify OPEN -> reset -> verify CLOSED
 */
export async function runBreakerTest() {
  const ok = await ensureService();
  if (!ok) {
    return { passed: false, reason: 'Service not initialized' };
  }

  const svc = ChatService.llmService;
  const before = svc.getHealthStatus?.() || {};
  try {
    svc.debugTripCircuitBreaker?.();
    const afterTrip = svc.getHealthStatus?.() || {};
    const opened = afterTrip?.breaker?.state === 'OPEN';

    svc.debugResetCircuitBreaker?.();
    const afterReset = svc.getHealthStatus?.() || {};
    const closed = afterReset?.breaker?.state === 'CLOSED';

    return {
      passed: opened && closed,
      steps: {
        before: before?.breaker?.state || 'n/a',
        afterTrip: afterTrip?.breaker?.state || 'n/a',
        afterReset: afterReset?.breaker?.state || 'n/a'
      }
    };
  } catch (e) {
    return { passed: false, error: e?.message || String(e) };
  }
}

/**
 * Inject synthetic successes and failures and validate rolling metrics shape.
 */
export async function runHealthSmokeTest() {
  const ok = await ensureService();
  if (!ok) {
    return { passed: false, reason: 'Service not initialized' };
  }

  const svc = ChatService.llmService;

  try {
    // Start from clean breaker state
    svc.debugResetCircuitBreaker?.();

    // Successes
    svc.debugMarkSuccess?.(80);
    await sleep(20);
    svc.debugMarkSuccess?.(120);
    await sleep(20);

    // Failure (non-critical)
    svc.debugFailOnce?.('Synthetic failure (health test)');
    await sleep(20);

    // Another success should close HALF_OPEN if it was set
    svc.debugMarkSuccess?.(90);

    const status = svc.getHealthStatus?.() || {};
    const hasRolling = !!status.rollingWindow && typeof status.rollingWindow.requests === 'number';

    return {
      passed: hasRolling,
      snapshot: {
        requestCount: status.requestCount,
        successRate: status.successRate,
        avgLatency: status.averageResponseTime,
        rolling: status.rollingWindow,
        breaker: status.breaker,
        lastError: status.lastError
      }
    };
  } catch (e) {
    return { passed: false, error: e?.message || String(e) };
  }
}

/**
 * Perform a minimal streaming request to validate the provider path.
 * This does not rely on tools and should complete quickly across providers.
 */
export async function runPromptSmokeTest() {
  const ok = await ensureService();
  if (!ok) {
    return { passed: false, reason: 'Service not initialized' };
  }

  try {
    const text = await ChatService.sendPrompt('Respond with exactly: OK', { tools: [], history: [] });
    const normalized = (text || '').trim().toUpperCase();
    const matched = normalized.includes('OK');
    return { passed: matched, responsePreview: (text || '').slice(0, 160) };
  } catch (e) {
    return { passed: false, error: e?.message || String(e) };
  }
}

/**
 * Full suite
 */
export async function runSmokeSuite() {
  const results = {
    breaker: await runBreakerTest(),
    health: await runHealthSmokeTest(),
    prompt: await runPromptSmokeTest()
  };
  const passed = results.breaker.passed && results.health.passed && results.prompt.passed;
  return { passed, results };
}
/**
 * Tool-calling E2E parity tests
 * Validates that providers which support function calling emit tool_call events and complete a simple tool flow.
 */
export async function runToolCallReadFileTest(filename = 'README.md') {
  const ok = await ensureService();
  if (!ok) {
    return { passed: false, reason: 'Service not initialized' };
  }

  const svc = ChatService.llmService;
  const facade = ChatService.llmFacade || null;

  const caps = (svc && svc.getCapabilities) ? (svc.getCapabilities() || {}) : {};
  const provider =
    caps.provider ||
    (svc?.constructor?.name || '').replace('Service', '').toLowerCase() ||
    'unknown';
  const supportsTools = caps.supportsFunctionCalling !== false;

  // Prepare tools via ToolExecutor.getToolDefinitions()
  let tools;
  try {
    const toolDefsMod = await import('../tool_executor.js');
    tools = toolDefsMod.getToolDefinitions();
  } catch (e) {
    return { passed: false, error: `Failed to import ToolExecutor.getToolDefinitions(): ${e?.message || e}` };
  }

  // Prompt: Force a single read_file call, then a short acknowledgment
  const prompt = [
    'You can call tools. Do the following steps:',
    `1) Call the tool "read_file" with { filename: "${filename}", include_line_numbers: false }`,
    '2) After you receive the tool result, respond with the exact text: TOOL_FLOW_OK',
    'Rules:',
    '- If tools are not available, respond with: TOOLS_UNAVAILABLE',
    '- Keep responses minimal.',
  ].join('\n');

  // Build initial history (facade will ensure a system turn)
  const history = [{ role: 'user', parts: [{ text: prompt }] }];

  const providerKey = provider;
  let observedToolCalls = 0;
  let executedTools = 0;
  let finalText = '';
  let iterations = 0;

  try {
    // Up to 3 iterations: model -> tool(s) -> model continuation
    while (iterations++ < 3) {
      // Acquire stream
      const stream = facade
        ? facade.sendMessageStream(history, tools, 'code', '')
        : svc.sendMessageStream(history, tools, '');

      const functionCallsRaw = [];
      let textChunk = '';

      for await (const chunk of stream) {
        if (chunk?.text) {
          textChunk += chunk.text;
        }
        if (Array.isArray(chunk?.functionCalls) && chunk.functionCalls.length > 0) {
          functionCallsRaw.push(...chunk.functionCalls);
        }
      }

      finalText += textChunk;

      // If tool calls were emitted, normalize and execute them
      if (functionCallsRaw.length > 0) {
        observedToolCalls += functionCallsRaw.length;

        // Normalize tool calls (provider -> common {id, name, args})
        const { ToolAdapter } = await import('./tool_adapter.js');
        const normalizedCalls = ToolAdapter.fromProviderCalls(providerKey, functionCallsRaw);

        // Execute sequentially via ToolExecutor (silent mode)
        const toolResults = [];
        const toolExec = await import('../tool_executor.js');
        for (const call of normalizedCalls) {
          try {
            const execResult = await toolExec.execute(call, ChatService.rootDirectoryHandle, true);
            const responsePayload = execResult?.toolResponse?.response ?? execResult?.toolResponse ?? execResult;
            toolResults.push({
              id: call.id,
              name: call.name,
              response: responsePayload
            });
            executedTools++;
          } catch (e) {
            toolResults.push({
              id: call.id,
              name: call.name,
              response: { error: e?.message || String(e) }
            });
          }
        }

        // Feed tool responses back to the model
        history.push({
          role: 'user',
          parts: toolResults.map(fr => ({ functionResponse: fr }))
        });

        // Loop to allow the model to produce final text response
        continue;
      }

      // No tool calls; if the model already returned text and tools are unsupported, that may be acceptable
      break;
    }

    const normalizedText = (finalText || '').trim().toUpperCase();
    const toolAck = normalizedText.includes('TOOL_FLOW_OK');
    const toolsUnavailableAck = normalizedText.includes('TOOLS_UNAVAILABLE');

    // Pass criteria:
    // - If supports tools: must have observed tool calls (>=1). Acknowledgment text is a bonus.
    // - If does not support tools: must not have any tool calls; can return TOOLS_UNAVAILABLE or just plain text.
    const passed = supportsTools
      ? observedToolCalls > 0
      : observedToolCalls === 0;

    return {
      passed,
      provider,
      supportsTools,
      observedToolCalls,
      executedTools,
      iterations,
      toolAck,
      toolsUnavailableAck,
      responsePreview: (finalText || '').slice(0, 240)
    };
  } catch (e) {
    return { passed: false, error: e?.message || String(e), provider, supportsTools };
  }
}

/**
 * Parity suite wrapper for tool-calling
 */
export async function runToolParitySuite() {
  const singleReadFile = await runToolCallReadFileTest('README.md');
  const passed = singleReadFile.passed;
  return {
    passed,
    cases: {
      singleReadFile
    }
  };
}
/**
 * Chaos tests for retries, backoff, and key rotation
 * Requires BaseLLMService debug hooks: debugFailAttempts(), debugResetCircuitBreaker()
 */
export async function runRetryChaosTest({ failures = 2, type = 'rate_limit' } = {}) {
  const ok = await ensureService();
  if (!ok) return { passed: false, reason: 'Service not initialized' };

  const svc = ChatService.llmService;

  try {
    // Clean health/breaker
    svc.debugResetCircuitBreaker?.();

    const before = svc.getHealthStatus?.() || {};
    const beforeErrs = Array.isArray(before.recentErrors) ? before.recentErrors.length : 0;
    const startIndex = svc.apiKeyManager?.currentIndex ?? null;

    // Schedule N synthetic retryable failures before contacting provider
    svc.debugFailAttempts?.(failures, type);

    const t0 = performance.now();
    let response = '';
    try {
      response = await ChatService.sendPrompt('Respond with exactly: OK', { tools: [], history: [] });
    } catch (e) {
      // swallow to inspect health
    }
    const t1 = performance.now();

    const after = svc.getHealthStatus?.() || {};
    const afterErrs = Array.isArray(after.recentErrors) ? after.recentErrors.length : 0;
    const keyIndexEnd = svc.apiKeyManager?.currentIndex ?? null;

    const normalized = (response || '').trim().toUpperCase();
    const okFinal = normalized.includes('OK');

    // Rotation detection (may be null if single-key)
    const rotated = (startIndex !== null && keyIndexEnd !== null) ? (keyIndexEnd !== startIndex) : null;

    // We expect at least 'failures' transient errors recorded in the rolling window
    const errorDelta = Math.max(0, afterErrs - beforeErrs);

    return {
      passed: okFinal && errorDelta >= Math.min(failures, 3),
      details: {
        failuresScheduled: failures,
        failureType: type,
        errorDelta,
        rotated,
        keyIndexStart: startIndex,
        keyIndexEnd,
        elapsedMs: Math.round(t1 - t0),
        responsePreview: (response || '').slice(0, 200),
        breakerAfter: after.breaker
      }
    };
  } catch (e) {
    return { passed: false, error: e?.message || String(e) };
  }
}

/**
 * Aggregate chaos suite for resilience
 */
export async function runChaosSuite() {
  const retryRotation = await runRetryChaosTest({ failures: 2, type: 'rate_limit' });
  const passed = retryRotation.passed;
  return {
    passed,
    cases: { retryRotation }
  };
}
/**
 * Streaming cancellation and recovery tests
 * Validates that canceling an in-flight stream via AbortSignal terminates cleanly
 * and that subsequent requests succeed with coherent health/breaker state.
 */
export async function runCancelSmokeTest() {
  const ok = await ensureService();
  if (!ok) return { passed: false, reason: 'Service not initialized' };

  const svc = ChatService.llmService;
  const facade = ChatService.llmFacade;

  try {
    // Start from a clean breaker state
    svc.debugResetCircuitBreaker?.();

    const before = svc.getHealthStatus?.() || {};
    const breakerStart = before?.breaker?.state || 'UNKNOWN';

    // Prompt designed to stream for a while without tools
    const prompt = [
      'Stream a long response of at least 400 words.',
      'Do not call any tools. Use plain text only.',
      'Make the response incremental (token-by-token or sentence-by-sentence).'
    ].join(' ');

    const history = [{ role: 'user', parts: [{ text: prompt }] }];

    const controller = new AbortController();
    let gotChunks = 0;
    let received = '';
    let aborted = false;

    try {
      // Start streaming; pass AbortSignal to Facade/provider
      const stream = facade.sendMessageStream(history, [], 'code', '', controller.signal);

      // Abort as soon as we see the first chunk (or after 500ms fallback)
      let abortTimer = setTimeout(() => {
        try { controller.abort(); } catch (_) {}
      }, 500);

      for await (const chunk of stream) {
        if (chunk?.text) {
          received += chunk.text;
          gotChunks++;
          if (gotChunks === 1) {
            clearTimeout(abortTimer);
            // abort shortly after first chunk to ensure mid-stream cancel
            abortTimer = setTimeout(() => {
              try { controller.abort(); } catch (_) {}
            }, 50);
          }
        }
      }
    } catch (e) {
      // Expected: when AbortSignal triggers, provider path throws AbortError
      aborted = true;
    }

    const mid = svc.getHealthStatus?.() || {};
    const breakerMid = mid?.breaker?.state || 'UNKNOWN';

    // Immediately verify that a subsequent prompt succeeds
    let followupOK = false;
    try {
      const follow = await ChatService.sendPrompt('Respond with exactly: OK', { tools: [], history: [] });
      followupOK = (follow || '').trim().toUpperCase().includes('OK');
    } catch (e) {
      followupOK = false;
    }

    const after = svc.getHealthStatus?.() || {};
    const breakerAfter = after?.breaker?.state || 'UNKNOWN';

    const breakerNotOpen = breakerAfter !== 'OPEN';
    const hadAnyStream = gotChunks > 0;

    return {
      passed: hadAnyStream && aborted && followupOK && breakerNotOpen,
      details: {
        gotChunks,
        aborted,
        followupOK,
        breakerStart,
        breakerMid,
        breakerAfter,
        preview: (received || '').slice(0, 160)
      }
    };
  } catch (e) {
    return { passed: false, error: e?.message || String(e) };
  }
}

/**
 * Cancellation suite wrapper
 */
export async function runCancelSuite() {
  const cancelSmoke = await runCancelSmokeTest();
  const passed = cancelSmoke.passed;
  return {
    passed,
    cases: { cancelSmoke }
  };
}