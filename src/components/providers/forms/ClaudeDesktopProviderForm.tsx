import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { BasicFormFields } from "./BasicFormFields";
import { CodexOAuthSection } from "./CodexOAuthSection";
import { CopilotAuthSection } from "./CopilotAuthSection";
import { XaiOAuthSection } from "./XaiOAuthSection";
import { ApiKeySection } from "./shared/ApiKeySection";
import { EndpointField } from "./shared/EndpointField";
import { ModelDropdown } from "./shared/ModelDropdown";
import { ProviderPresetSelector } from "./ProviderPresetSelector";
import { useApiKeyLink } from "./hooks/useApiKeyLink";
import { providerSchema, type ProviderFormData } from "@/lib/schemas/provider";
import type { ClaudeDesktopModelRoute, ProviderCategory, ProviderMeta } from "@/types";
import type { OpenClawSuggestedDefaults } from "@/config/openclawProviderPresets";
import {
  claudeDesktopProviderPresets,
  type ClaudeDesktopProviderPreset,
} from "@/config/claudeDesktopProviderPresets";
import {
  fetchModelsForConfig,
  showFetchModelsError,
  type FetchedModel,
} from "@/lib/api/model-fetch";
import { resolveManagedAccountId } from "@/lib/authBinding";
import { useCopilotAuth, useCodexOauth, useXaiOauth } from "./hooks";
import { isOAuthProviderType } from "@/config/constants";

export type ClaudeDesktopProviderFormValues = ProviderFormData & {
  presetId?: string;
  presetCategory?: ProviderCategory;
  isPartner?: boolean;
  partnerPromotionKey?: string;
  meta?: ProviderMeta;
  providerKey?: string;
  suggestedDefaults?: OpenClawSuggestedDefaults;
};

type ApiKeyField = "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY";

type PresetEntry = {
  id: string;
  preset: ClaudeDesktopProviderPreset;
};

export interface ClaudeDesktopProviderFormProps {
  submitLabel: string;
  onSubmit: (values: ClaudeDesktopProviderFormValues) => Promise<void> | void;
  onCancel: () => void;
  onSubmittingChange?: (isSubmitting: boolean) => void;
  initialData?: {
    name?: string;
    websiteUrl?: string;
    notes?: string;
    settingsConfig?: Record<string, unknown>;
    category?: ProviderCategory;
    meta?: ProviderMeta;
    icon?: string;
    iconColor?: string;
  };
  showButtons?: boolean;
}

type RouteRow = { rowId: string; route: string; supports1m: boolean };

type RouteRowValues = Omit<RouteRow, "rowId">;
function envString(
  settingsConfig: Record<string, unknown> | undefined,
  key: string,
) {
  const env = settingsConfig?.env;
  if (!env || typeof env !== "object") return "";
  const value = (env as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function clonePlainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function createRouteRow(row: RouteRowValues): RouteRow {
  return {
    rowId: crypto.randomUUID(),
    ...row,
  };
}

function initialRouteRows(
  routes: Record<string, ClaudeDesktopModelRoute> | undefined,
): RouteRow[] {
  return Object.entries(routes ?? {}).map(([route, value]) => {
    return createRouteRow({
      route: value.model || route,
      supports1m: value.supports1m ?? false,
    });
  });
}

export function ClaudeDesktopProviderForm({
  submitLabel,
  onSubmit,
  onCancel,
  onSubmittingChange,
  initialData,
  showButtons = true,
}: ClaudeDesktopProviderFormProps) {
  const { t } = useTranslation();
  const [baseUrl, setBaseUrl] = useState(
    envString(initialData?.settingsConfig, "ANTHROPIC_BASE_URL"),
  );
  const [apiKey, setApiKey] = useState(
    envString(initialData?.settingsConfig, "ANTHROPIC_AUTH_TOKEN") ||
      envString(initialData?.settingsConfig, "ANTHROPIC_API_KEY"),
  );
  const [apiKeyField, setApiKeyField] = useState<ApiKeyField>(() =>
    envString(initialData?.settingsConfig, "ANTHROPIC_API_KEY")
      ? "ANTHROPIC_API_KEY"
      : "ANTHROPIC_AUTH_TOKEN",
  );
  const [selectedGitHubAccountId, setSelectedGitHubAccountId] = useState<
    string | null
  >(() => resolveManagedAccountId(initialData?.meta, "github_copilot"));
  const [selectedCodexAccountId, setSelectedCodexAccountId] = useState<
    string | null
  >(() => resolveManagedAccountId(initialData?.meta, "codex_oauth"));
  const [selectedXaiAccountId, setSelectedXaiAccountId] = useState<
    string | null
  >(() => resolveManagedAccountId(initialData?.meta, "xai_oauth"));
  const [codexFastMode, setCodexFastMode] = useState<boolean>(
    () => initialData?.meta?.codexFastMode ?? false,
  );
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(
    "custom",
  );
  const [activePreset, setActivePreset] = useState<{
    id: string;
    category?: ProviderCategory;
    isPartner?: boolean;
    partnerPromotionKey?: string;
    providerType?: string;
    requiresOAuth?: boolean;
  } | null>(null);
  const [routes, setRoutes] = useState<RouteRow[]>(() => {
    return initialRouteRows(initialData?.meta?.claudeDesktopModelRoutes);
  });
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [directModelsExpanded, setDirectModelsExpanded] = useState(
    Object.keys(initialData?.meta?.claudeDesktopModelRoutes ?? {}).length > 0,
  );

  const defaultValues: ProviderFormData = useMemo(
    () => ({
      name: initialData?.name ?? "",
      websiteUrl: initialData?.websiteUrl ?? "",
      notes: initialData?.notes ?? "",
      settingsConfig: JSON.stringify(
        initialData?.settingsConfig ?? { env: {} },
        null,
        2,
      ),
      icon: initialData?.icon ?? "",
      iconColor: initialData?.iconColor ?? "",
    }),
    [initialData],
  );

  const form = useForm<ProviderFormData>({
    resolver: zodResolver(providerSchema),
    defaultValues,
    mode: "onSubmit",
  });

  useEffect(() => {
    onSubmittingChange?.(form.formState.isSubmitting || isFetchingModels);
  }, [form.formState.isSubmitting, isFetchingModels, onSubmittingChange]);

  const presetEntries = useMemo<PresetEntry[]>(
    () =>
      claudeDesktopProviderPresets.map((preset, index) => ({
        id: `claude-desktop-${index}`,
        preset,
      })),
    [],
  );

  const presetCategoryLabels: Record<string, string> = useMemo(
    () => ({
      official: t("providerForm.categoryOfficial", { defaultValue: "官方" }),
      cn_official: t("providerForm.categoryCnOfficial", {
        defaultValue: "国内官方",
      }),
      aggregator: t("providerForm.categoryAggregation", {
        defaultValue: "聚合服务",
      }),
      third_party: t("providerForm.categoryThirdParty", {
        defaultValue: "第三方",
      }),
    }),
    [t],
  );
  const activeProviderType =
    activePreset?.providerType ?? initialData?.meta?.providerType;
  const { isAuthenticated: isCopilotAuthenticated, accounts: copilotAccounts } =
    useCopilotAuth();
  const {
    isAuthenticated: isCodexOauthAuthenticated,
    accounts: codexOauthAccounts,
  } = useCodexOauth();
  const {
    isAuthenticated: isXaiOauthAuthenticated,
    accounts: xaiOauthAccounts,
  } = useXaiOauth();
  const isOfficial =
    initialData?.category === "official" ||
    activePreset?.category === "official";
  const usesManagedOAuth =
    activePreset?.requiresOAuth === true ||
    isOAuthProviderType(activeProviderType);

  // API Key 获取/邀请链接（与 Claude Code 表单同款，见 ClaudeFormFields）
  const apiKeyLinkCategory = activePreset?.category ?? initialData?.category;
  const {
    shouldShowApiKeyLink,
    websiteUrl: apiKeyLinkWebsiteUrl,
    isPartner: apiKeyLinkIsPartner,
    partnerPromotionKey: apiKeyLinkPromotionKey,
  } = useApiKeyLink({
    appId: "claude-desktop",
    category: apiKeyLinkCategory,
    selectedPresetId,
    presetEntries,
    formWebsiteUrl: form.watch("websiteUrl") || "",
  });

  const applyDesktopPreset = (preset: ClaudeDesktopProviderPreset) => {
    form.setValue("name", preset.nameKey ? t(preset.nameKey) : preset.name);
    form.setValue("websiteUrl", preset.websiteUrl);
    form.setValue("notes", "");
    form.setValue("icon", preset.icon ?? "");
    form.setValue("iconColor", preset.iconColor ?? "");

    setBaseUrl(preset.baseUrl);
    setApiKey("");
    setApiKeyField(preset.apiKeyField ?? "ANTHROPIC_AUTH_TOKEN");
    setRoutes(
      preset.modelRoutes?.map((route) =>
        createRouteRow({
          route: route.upstreamModel || route.routeId,
          supports1m: route.supports1m,
        }),
      ) ?? [],
    );
  };

  const handlePresetChange = (value: string) => {
    setSelectedPresetId(value);

    if (value === "custom") {
      setActivePreset(null);
      form.reset(defaultValues);
      setBaseUrl("");
      setApiKey("");
      setApiKeyField("ANTHROPIC_AUTH_TOKEN");
      setRoutes([]);
      return;
    }

    const entry = presetEntries.find((item) => item.id === value);
    if (!entry) return;

    setActivePreset({
      id: value,
      category: entry.preset.category,
      isPartner: entry.preset.isPartner,
      partnerPromotionKey: entry.preset.partnerPromotionKey,
      providerType: entry.preset.providerType,
      requiresOAuth: entry.preset.requiresOAuth,
    });
    applyDesktopPreset(entry.preset);
  };

  const updateRoute = (index: number, patch: Partial<RouteRowValues>) => {
    setRoutes((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const handleFetchModels = async () => {
    if (!baseUrl.trim() || !apiKey.trim()) {
      showFetchModelsError(null, t, {
        hasBaseUrl: Boolean(baseUrl.trim()),
        hasApiKey: Boolean(apiKey.trim()),
      });
      return;
    }

    setIsFetchingModels(true);
    try {
      const models = await fetchModelsForConfig(baseUrl.trim(), apiKey.trim());
      setFetchedModels(models);
      toast.success(
        t("providerForm.fetchModelsSuccess", {
          count: models.length,
          defaultValue: `已获取 ${models.length} 个模型`,
        }),
      );
    } catch (error) {
      showFetchModelsError(error, t, {
        hasBaseUrl: Boolean(baseUrl.trim()),
        hasApiKey: Boolean(apiKey.trim()),
      });
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleSubmit = async (values: ProviderFormData) => {
    if (!values.name.trim()) {
      toast.error(
        t("providerForm.fillSupplierName", {
          defaultValue: "请填写供应商名称",
        }),
      );
      return;
    }
    if (isOfficial) {
      // 官方供应商使用 Claude Desktop 内置 1P 模式，保持空 env 占位；
      // 不写 claudeDesktopMode / claudeDesktopModelRoutes / apiFormat，
      // 与启动 seed 的 OFFICIAL_SEEDS 占位语义一致。
      const settingsConfig = clonePlainRecord(initialData?.settingsConfig);
      settingsConfig.env = {};
      const meta: ProviderMeta = { ...(initialData?.meta ?? {}) };
      delete meta.claudeDesktopMode;
      delete meta.claudeDesktopModelRoutes;
      delete meta.apiFormat;
      delete meta.endpointAutoSelect;
      delete meta.isFullUrl;
      await onSubmit({
        ...values,
        name: values.name.trim(),
        websiteUrl: values.websiteUrl?.trim() ?? "",
        notes: values.notes?.trim() ?? "",
        settingsConfig: JSON.stringify(settingsConfig, null, 2),
        meta,
        presetId: activePreset?.id,
        presetCategory: "official",
      });
      return;
    }
    if (!baseUrl.trim() && !usesManagedOAuth) {
      toast.error(
        t("providerForm.fetchModelsNeedEndpoint", {
          defaultValue: "请先填写接口地址",
        }),
      );
      return;
    }
    const selectedAccountIsUsable = (
      accountId: string | null,
      accounts: Array<{ id: string; requires_reauth: boolean }>,
    ) =>
      accountId === null ||
      accounts.some(
        (account) => account.id === accountId && !account.requires_reauth,
      );
    const managedAuthState =
      activeProviderType === "github_copilot"
        ? {
            authenticated: isCopilotAuthenticated,
            accountId: selectedGitHubAccountId,
            accounts: copilotAccounts,
            loginMessage: t("copilot.loginRequired", {
              defaultValue: "请先登录 GitHub Copilot",
            }),
          }
        : activeProviderType === "codex_oauth"
          ? {
              authenticated: isCodexOauthAuthenticated,
              accountId: selectedCodexAccountId,
              accounts: codexOauthAccounts,
              loginMessage: t("codexOauth.loginRequired", {
                defaultValue: "请先登录 ChatGPT 账号",
              }),
            }
          : activeProviderType === "xai_oauth"
            ? {
                authenticated: isXaiOauthAuthenticated,
                accountId: selectedXaiAccountId,
                accounts: xaiOauthAccounts,
                loginMessage: t("xaiOauth.loginRequired", {
                  defaultValue: "请先登录 xAI 账号",
                }),
              }
            : null;
    if (managedAuthState && !managedAuthState.authenticated) {
      toast.error(managedAuthState.loginMessage);
      return;
    }
    if (
      managedAuthState &&
      !selectedAccountIsUsable(
        managedAuthState.accountId,
        managedAuthState.accounts,
      )
    ) {
      toast.error(
        t("managedAuth.selectedAccountUnavailable", {
          defaultValue: "已绑定账号不存在或需要重新登录，请重新选择账号",
        }),
      );
      return;
    }
    if (!usesManagedOAuth && !apiKey.trim()) {
      toast.error(
        t("providerForm.fetchModelsNeedApiKey", {
          defaultValue: "请先填写 API Key",
        }),
      );
      return;
    }

    const routeEntries = routes
      .map((route) => ({
        route: route.route.trim(),
        supports1m: route.supports1m,
      }))
      .filter((route) => route.route);

    const settingsConfig = clonePlainRecord(initialData?.settingsConfig);
    const env = clonePlainRecord(settingsConfig.env);
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_API_KEY;
    settingsConfig.env = usesManagedOAuth
      ? {
          ...env,
          ANTHROPIC_BASE_URL: baseUrl.trim().replace(/\/+$/, ""),
        }
      : {
          ...env,
          ANTHROPIC_BASE_URL: baseUrl.trim().replace(/\/+$/, ""),
          [apiKeyField]: apiKey.trim(),
        };

    const routeMap = routeEntries.reduce<
      Record<string, ClaudeDesktopModelRoute>
    >((acc, route) => {
      acc[route.route] = {
        model: route.route,
        supports1m: route.supports1m || undefined,
      };
      return acc;
    }, {});

    const meta: ProviderMeta = {
      ...(initialData?.meta ?? {}),
    };

    delete meta.claudeDesktopMode;
    delete meta.apiFormat;
    meta.claudeDesktopModelRoutes = routeMap;
    meta.providerType = activeProviderType;
    meta.authBinding =
      activeProviderType === "github_copilot"
        ? {
            source: "managed_account",
            authProvider: "github_copilot",
            accountId: selectedGitHubAccountId ?? undefined,
          }
        : activeProviderType === "codex_oauth"
          ? {
              source: "managed_account",
              authProvider: "codex_oauth",
              accountId: selectedCodexAccountId ?? undefined,
            }
          : activeProviderType === "xai_oauth"
            ? {
                source: "managed_account",
                authProvider: "xai_oauth",
                accountId: selectedXaiAccountId ?? undefined,
              }
            : undefined;
    meta.codexFastMode =
      activeProviderType === "codex_oauth" ? codexFastMode : undefined;

    delete meta.endpointAutoSelect;
    delete meta.isFullUrl;

    await onSubmit({
      ...values,
      name: values.name.trim(),
      websiteUrl: values.websiteUrl?.trim() ?? "",
      notes: values.notes?.trim() ?? "",
      settingsConfig: JSON.stringify(settingsConfig, null, 2),
      meta,
      presetId: activePreset?.id,
      presetCategory: activePreset?.category,
      isPartner: activePreset?.isPartner,
      partnerPromotionKey: activePreset?.partnerPromotionKey,
    });
  };

  const renderActionButtons = (onAdd: () => void, addLabel: string) => (
    <div className="flex gap-1">
      {!usesManagedOAuth && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleFetchModels}
          disabled={isFetchingModels}
          className="h-7 gap-1"
        >
          {isFetchingModels ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          {t("providerForm.fetchModels", { defaultValue: "获取模型" })}
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onAdd}
        className="h-7 gap-1"
      >
        <Plus className="h-3.5 w-3.5" />
        {addLabel}
      </Button>
    </div>
  );

  return (
    <Form {...form}>
      <form
        id="provider-form"
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-6"
      >
        {!initialData && (
          <ProviderPresetSelector
            selectedPresetId={selectedPresetId}
            presetEntries={presetEntries}
            presetCategoryLabels={presetCategoryLabels}
            onPresetChange={handlePresetChange}
            category={activePreset?.category}
          />
        )}

        <BasicFormFields form={form} />

        {isOfficial && (
          <div className="rounded-lg border border-border-default bg-muted/20 p-3 text-sm text-muted-foreground">
            {t("claudeDesktop.officialNotice", {
              defaultValue:
                "Claude Desktop 官方供应商使用应用内置的 1P 登录，无需配置 API Key 和接口地址。",
            })}
          </div>
        )}

        {!isOfficial && (
          <>
            {usesManagedOAuth ? (
              <div className="rounded-lg border border-border-default bg-muted/20 p-3">
                {activeProviderType === "github_copilot" ? (
                  <CopilotAuthSection
                    selectedAccountId={selectedGitHubAccountId}
                    onAccountSelect={setSelectedGitHubAccountId}
                  />
                ) : activeProviderType === "codex_oauth" ? (
                  <CodexOAuthSection
                    selectedAccountId={selectedCodexAccountId}
                    onAccountSelect={setSelectedCodexAccountId}
                    fastModeEnabled={codexFastMode}
                    onFastModeChange={setCodexFastMode}
                  />
                ) : (
                  <XaiOAuthSection
                    selectedAccountId={selectedXaiAccountId}
                    onAccountSelect={setSelectedXaiAccountId}
                  />
                )}
              </div>
            ) : (
              <ApiKeySection
                value={apiKey}
                onChange={setApiKey}
                category={apiKeyLinkCategory}
                shouldShowLink={shouldShowApiKeyLink}
                websiteUrl={apiKeyLinkWebsiteUrl}
                isPartner={apiKeyLinkIsPartner}
                partnerPromotionKey={apiKeyLinkPromotionKey}
              />
            )}

            <EndpointField
              id="baseUrl"
              label={t("providerForm.apiEndpoint")}
              value={baseUrl}
              onChange={(v) => setBaseUrl(v)}
              placeholder={t("providerForm.apiEndpointPlaceholder")}
              hint={t("providerForm.apiHint")}
              showManageButton={false}
            />

            <>
              <Collapsible
                open={directModelsExpanded}
                onOpenChange={setDirectModelsExpanded}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant={null}
                    size="sm"
                    className="h-8 gap-1.5 px-0 text-sm font-medium text-foreground hover:opacity-70"
                  >
                    {directModelsExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    {t("claudeDesktop.directModelListTitle", {
                      defaultValue:
                        "手动指定 Claude Desktop 模型列表（高级，可选）",
                    })}
                  </Button>
                </CollapsibleTrigger>
                {!directModelsExpanded && (
                  <p className="ml-1 mt-1 text-xs text-muted-foreground">
                    {t("claudeDesktop.directModelListCollapsedHint", {
                      defaultValue:
                        "原生 Claude 模型供应商通常不用填写，Claude Desktop 会自动读取 /v1/models。",
                    })}
                  </p>
                )}
                <CollapsibleContent className="space-y-4 pt-2">
                  <div className="space-y-4 rounded-lg border border-border-default p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <p className="flex-1 text-xs leading-relaxed text-muted-foreground">
                        {t("claudeDesktop.directModelListHint", {
                          defaultValue:
                            "仅当供应商的 /v1/models 不可用或没有返回 Claude Desktop 可识别的 Sonnet / Opus / Haiku 模型名时填写；勾选 1M 会向 Claude Desktop 声明支持 1M 上下文。",
                        })}
                      </p>
                      {renderActionButtons(
                        () =>
                          setRoutes((current) => [
                            ...current,
                            createRouteRow({
                              route: "",
                              supports1m: false,
                            }),
                          ]),
                        t("claudeDesktop.addModel", {
                          defaultValue: "添加模型",
                        }),
                      )}
                    </div>

                    {routes.length > 0 ? (
                      <div className="space-y-2">
                        {routes.map((route, index) => (
                          <div
                            key={route.rowId}
                            className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_116px_36px]"
                          >
                            <div className="flex gap-1">
                              <Input
                                value={route.route}
                                onChange={(event) =>
                                  updateRoute(index, {
                                    route: event.target.value,
                                  })
                                }
                                placeholder="claude-sonnet-4-6"
                                className="flex-1"
                              />
                              {fetchedModels.length > 0 && (
                                <ModelDropdown
                                  models={fetchedModels}
                                  onSelect={(id) =>
                                    updateRoute(index, { route: id })
                                  }
                                />
                              )}
                            </div>
                            <label className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
                              <Checkbox
                                checked={route.supports1m}
                                onCheckedChange={(checked) =>
                                  updateRoute(index, {
                                    supports1m: checked === true,
                                  })
                                }
                              />
                              {t("claudeDesktop.supports1mShort", {
                                defaultValue: "1M",
                              })}
                            </label>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                setRoutes((current) =>
                                  current.filter((_, i) => i !== index),
                                )
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </>

            <FormField
              control={form.control}
              name="settingsConfig"
              render={() => (
                <FormItem className="space-y-0">
                  <FormControl>
                    <input type="hidden" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}

        {showButtons && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {submitLabel}
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}
