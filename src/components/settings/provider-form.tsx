"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  useModelStore,
  type Provider,
  type Protocol,
  type Capability,
} from "@/stores/model-store";
import { useTranslations } from "next-intl";
import { Loader2, Download, Plus, Eye, EyeOff, Trash2, Search } from "lucide-react";

const DEFAULT_BASE_URLS: Record<Protocol, string> = {
  openai: "https://api.openai.com",
  grok: "https://api.x.ai",
  gemini: "https://generativelanguage.googleapis.com",
  seedance: "https://ark.cn-beijing.volces.com",
  "ucloud-seedance": "https://api.modelverse.cn",
  kling: "https://api.klingai.com",
  wan: "https://dashscope.aliyuncs.com/api/v1",
  dashscope: "https://dashscope.aliyuncs.com/api/v1",
};

function getProtocolOptions(capability: Capability): { value: Protocol; label: string }[] {
  if (capability === "text") {
    return [
      { value: "openai", label: "OpenAI" },
      { value: "gemini", label: "Gemini" },
    ];
  }
  if (capability === "image") {
    return [
      { value: "openai", label: "OpenAI" },
      { value: "gemini", label: "Gemini" },
      { value: "kling", label: "Kling" },
      { value: "dashscope", label: "百炼 (图片)" },
    ];
  }
  // video
  return [
    { value: "grok", label: "Grok (xAI)" },
    { value: "seedance", label: "Seedance" },
    { value: "ucloud-seedance", label: "Seedance (UCloud)" },
    { value: "gemini", label: "Gemini (Veo)" },
    { value: "kling", label: "Kling" },
    { value: "wan", label: "百炼 (视频)" },
  ];
}

interface ProviderFormProps {
  provider: Provider;
}

export function ProviderForm({ provider }: ProviderFormProps) {
  const t = useTranslations("settings");
  const { updateProvider, setModels, toggleModel, addManualModel, removeModel } =
    useModelStore();
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [manualModelId, setManualModelId] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [modelSearch, setModelSearch] = useState("");

  const isKling = provider.protocol === "kling";

  async function handleFetchModels() {
    setFetching(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/models/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocol: provider.protocol,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFetchError(data.error || "Failed to fetch models");
        return;
      }
      const models = data.models.map((m: { id: string; name: string }) => ({
        id: m.id,
        name: m.name,
        checked: false,
      }));
      setModels(provider.id, models);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Network error");
    } finally {
      setFetching(false);
    }
  }

  function handleAddManualModel() {
    const id = manualModelId.trim();
    if (!id) return;
    addManualModel(provider.id, id);
    setManualModelId("");
  }

  return (
    <div className="space-y-5">
      {/* Row 1: Name + Protocol */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1.5">
          <Label className="text-xs">{t("providerName")}</Label>
          <Input
            value={provider.name}
            onChange={(e) =>
              updateProvider(provider.id, { name: e.target.value })
            }
            placeholder="e.g. DeepSeek, OpenRouter..."
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t("protocol")}</Label>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {getProtocolOptions(provider.capability).map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  const isDefaultUrl = !provider.baseUrl || (Object.values(DEFAULT_BASE_URLS) as string[]).includes(provider.baseUrl);
                  updateProvider(provider.id, {
                    protocol: opt.value,
                    ...(isDefaultUrl && { baseUrl: DEFAULT_BASE_URLS[opt.value] }),
                  });
                }}
                className={`rounded-lg border px-2.5 py-[7px] text-xs transition-all ${
                  provider.protocol === opt.value
                    ? "border-primary/30 bg-primary/8 text-primary font-medium"
                    : "border-[--border-subtle] text-[--text-secondary] hover:border-[--border-hover]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Row 2: Base URL + API Key (or AK+SK stacked for Kling) */}
      {isKling ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Base URL</Label>
            <Input
              value={provider.baseUrl}
              onChange={(e) =>
                updateProvider(provider.id, { baseUrl: e.target.value })
              }
              placeholder="https://api.klingai.com"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Access Key (AK)</Label>
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  value={provider.apiKey}
                  onChange={(e) =>
                    updateProvider(provider.id, { apiKey: e.target.value })
                  }
                  placeholder="Access Key..."
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-lg text-[--text-muted] hover:text-[--text-primary]"
                >
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Secret Key (SK)</Label>
              <div className="relative">
                <Input
                  type={showSecretKey ? "text" : "password"}
                  value={provider.secretKey ?? ""}
                  onChange={(e) =>
                    updateProvider(provider.id, { secretKey: e.target.value })
                  }
                  placeholder="Secret Key..."
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowSecretKey(!showSecretKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-lg text-[--text-muted] hover:text-[--text-primary]"
                >
                  {showSecretKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Base URL</Label>
            <Input
              value={provider.baseUrl}
              onChange={(e) =>
                updateProvider(provider.id, { baseUrl: e.target.value })
              }
              placeholder="https://api.openai.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">API Key</Label>
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                value={provider.apiKey}
                onChange={(e) =>
                  updateProvider(provider.id, { apiKey: e.target.value })
                }
                placeholder="sk-..."
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-lg text-[--text-muted] hover:text-[--text-primary]"
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Divider */}
      <div className="border-t border-[--border-subtle]" />

      {/* Row 3: Models */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs">{t("models")}</Label>
          <Button
            size="sm"
            variant="outline"
            onClick={handleFetchModels}
            disabled={fetching || (!provider.apiKey && provider.protocol !== "kling")}
          >
            {fetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {t("fetchModels")}
          </Button>
        </div>

        {fetchError && (
          <div className="rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2">
            <p className="text-xs text-destructive">{fetchError}</p>
          </div>
        )}

        {/* Manual model input */}
        <div className="flex gap-2">
          <Input
            value={manualModelId}
            onChange={(e) => setManualModelId(e.target.value)}
            placeholder={t("manualModelPlaceholder")}
            onKeyDown={(e) => e.key === "Enter" && handleAddManualModel()}
            className="flex-1"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleAddManualModel}
            disabled={!manualModelId.trim()}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Model list with search */}
        {provider.models.length > 0 && (() => {
          const query = modelSearch.toLowerCase();
          const filtered = query
            ? provider.models.filter(
                (m) =>
                  m.id.toLowerCase().includes(query) ||
                  m.name.toLowerCase().includes(query)
              )
            : provider.models;
          const checkedCount = provider.models.filter((m) => m.checked).length;

          return (
            <div className="rounded-xl border border-[--border-subtle] overflow-hidden">
              {/* Search bar + stats */}
              <div className="flex items-center gap-2 border-b border-[--border-subtle] bg-[--surface]/50 px-3 py-2">
                <Search className="h-3.5 w-3.5 flex-shrink-0 text-[--text-muted]" />
                <input
                  type="text"
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  placeholder={t("searchModels")}
                  className="flex-1 bg-transparent text-xs text-[--text-primary] outline-none placeholder:text-[--text-muted]"
                />
                <span className="flex-shrink-0 text-[10px] tabular-nums text-[--text-muted]">
                  {checkedCount} / {provider.models.length}
                </span>
              </div>
              {/* Model grid */}
              <div className="max-h-56 overflow-y-auto p-1.5">
                {filtered.length === 0 ? (
                  <p className="py-4 text-center text-xs text-[--text-muted]">
                    No models found
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2 lg:grid-cols-3">
                    {filtered.map((model) => (
                      <label
                        key={model.id}
                        className={`group/item flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors ${
                          model.checked
                            ? "bg-primary/5"
                            : "hover:bg-[--surface]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={model.checked}
                          onChange={() => toggleModel(provider.id, model.id)}
                          className="h-3.5 w-3.5 flex-shrink-0 rounded border-[--border-subtle] text-primary accent-primary"
                        />
                        <span
                          className={`min-w-0 flex-1 truncate text-xs ${
                            model.checked
                              ? "font-medium text-[--text-primary]"
                              : "text-[--text-secondary]"
                          }`}
                          title={model.id}
                        >
                          {model.name}
                        </span>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            removeModel(provider.id, model.id);
                          }}
                          className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-[--text-muted] opacity-0 transition-all hover:text-destructive group-hover/item:opacity-100"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
