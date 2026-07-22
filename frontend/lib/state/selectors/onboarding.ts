import { useShallow } from 'zustand/react/shallow';
import type { OnboardingChecklistItem, SupplyLinkStore } from '../types';
import { useStore } from '../store';

export function selectOnboardingCompleted(state: SupplyLinkStore): boolean {
  return state.onboardingCompleted;
}

export function selectOnboardingChecklist(state: SupplyLinkStore): OnboardingChecklistItem[] {
  return state.onboardingChecklist;
}

export function selectOnboardingProgress(state: SupplyLinkStore): number {
  return state.onboardingProgress;
}

export interface OnboardingSummary {
  onboardingCompleted: boolean;
  onboardingChecklist: OnboardingChecklistItem[];
  onboardingProgress: number;
}

/** Grouped read of the three onboarding display fields — one useShallow
 *  subscription instead of three separate `useStore` calls. */
export function selectOnboardingSummary(state: SupplyLinkStore): OnboardingSummary {
  return {
    onboardingCompleted: state.onboardingCompleted,
    onboardingChecklist: state.onboardingChecklist,
    onboardingProgress: state.onboardingProgress,
  };
}

export function useOnboardingSummary(): OnboardingSummary {
  return useStore(useShallow(selectOnboardingSummary));
}
