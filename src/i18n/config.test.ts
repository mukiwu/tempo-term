import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANGUAGE,
  resolveLanguage,
  resources,
  SUPPORTED_LANGUAGES,
} from "./config";

describe("resolveLanguage", () => {
  it("maps Traditional Chinese locales to zh-Hant", () => {
    expect(resolveLanguage("zh-TW")).toBe("zh-Hant");
    expect(resolveLanguage("zh-Hant")).toBe("zh-Hant");
    expect(resolveLanguage("zh-Hant-TW")).toBe("zh-Hant");
    expect(resolveLanguage("zh-HK")).toBe("zh-Hant");
  });

  it("maps English locales to en", () => {
    expect(resolveLanguage("en")).toBe("en");
    expect(resolveLanguage("en-US")).toBe("en");
  });

  it("falls back to the default language for unknown or empty input", () => {
    expect(resolveLanguage("fr")).toBe(DEFAULT_LANGUAGE);
    expect(resolveLanguage("")).toBe(DEFAULT_LANGUAGE);
    expect(resolveLanguage(undefined)).toBe(DEFAULT_LANGUAGE);
    expect(resolveLanguage(null)).toBe(DEFAULT_LANGUAGE);
  });
});

describe("locale resource parity", () => {
  // Every translation key shipped in English must also exist in every other
  // language, otherwise the UI would silently fall back to English strings.
  function collectKeys(obj: Record<string, unknown>, prefix = ""): string[] {
    return Object.entries(obj).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return collectKeys(value as Record<string, unknown>, path);
      }
      return [path];
    });
  }

  const namespaces = Object.keys(resources.en) as Array<keyof typeof resources.en>;

  for (const lang of SUPPORTED_LANGUAGES) {
    for (const ns of namespaces) {
      it(`has every "${ns}" key for ${lang}`, () => {
        const enKeys = collectKeys(resources.en[ns]).sort();
        const langKeys = collectKeys(
          resources[lang][ns] as Record<string, unknown>,
        ).sort();
        expect(langKeys).toEqual(enKeys);
      });
    }
  }
});
