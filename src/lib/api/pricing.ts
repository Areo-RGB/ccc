import { invoke } from "@tauri-apps/api/core";

export const pricingApi = {
  async getDefaultCostMultiplier(appType: string): Promise<string> {
    return invoke("get_default_cost_multiplier", { appType });
  },

  async setDefaultCostMultiplier(
    appType: string,
    value: string,
  ): Promise<void> {
    return invoke("set_default_cost_multiplier", { appType, value });
  },

  async getPricingModelSource(appType: string): Promise<string> {
    return invoke("get_pricing_model_source", { appType });
  },

  async setPricingModelSource(appType: string, value: string): Promise<void> {
    return invoke("set_pricing_model_source", { appType, value });
  },
};