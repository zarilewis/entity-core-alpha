/**
 * Consolidation Module
 *
 * Exports for memory consolidation (daily→weekly→monthly→yearly).
 */

export {
  consolidate,
  findUnconsolidatedPeriods,
  runAllConsolidations,
  runConsolidation,
  type ConsolidationResult,
} from "./consolidator.ts";

export {
  getISOWeek,
  getISOWeekMonday,
  getWeekStart,
  getMonthStart,
  getPreviousPeriodStart,
  getConsolidationDateInfo,
  parseTargetDate,
  filterFilesForPeriod,
} from "./periods.ts";

export {
  WEEKLY_CONSOLIDATION_PROMPT,
  MONTHLY_CONSOLIDATION_PROMPT,
  YEARLY_CONSOLIDATION_PROMPT,
} from "./prompts.ts";
