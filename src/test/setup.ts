/**
 * Vitest setup: tell React that this is an act() environment so state updates
 * triggered from tests are flushed synchronously.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
