import { HOUSEHOLD_ACCOUNT_PRESETS } from './actuynab-household';

/**
 * A fictional shared household setup for integration tests. It deliberately
 * contains no real account numbers, balances, loan terms, or bank files.
 */
export function syntheticHouseholdSetupFixture() {
  return {
    accounts: HOUSEHOLD_ACCOUNT_PRESETS.map(preset => ({
      key: preset.key,
      name: `Synthetic ${preset.defaultName}`,
      transferDescriptionTokens: [...preset.defaultTransferDescriptionTokens],
    })),
    applyCategoryTemplate: true,
  };
}
