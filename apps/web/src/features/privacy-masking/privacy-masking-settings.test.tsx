import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultPrivacyMaskingSettings } from "@linksense/shared";

import i18n from "@/i18n";
import { PrivacyMaskingSettingsCard } from "@/features/privacy-masking/privacy-masking-settings";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PrivacyMaskingSettingsCard />
    </QueryClientProvider>
  );
}

describe("privacy masking settings card", () => {
  it.each(["zh-CN", "en-US", "es-ES", "pt-BR", "fr-FR", "ja-JP"])(
    "renders the saved settings in %s",
    async (language) => {
      await i18n.changeLanguage(language);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          envelope({
            revision: 0,
            settings: defaultPrivacyMaskingSettings,
          })
        )
      );
      renderCard();
      expect(
        await screen.findByRole("switch", {
          name: i18n.t("settings.privacyMaskingEnabled"),
        })
      ).not.toBeChecked();
      expect(
        screen.getByRole("button", {
          name: i18n.t("settings.privacyMaskingSave"),
        })
      ).toBeDisabled();
    }
  );

  it("saves the switch and parsed custom words", async () => {
    await i18n.changeLanguage("en-US");
    let settings = { ...defaultPrivacyMaskingSettings };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as {
            expected_revision: number;
            settings: typeof settings;
          };
          settings = body.settings;
          return envelope({ revision: 1, settings });
        }
        expect(path).toBe("/api/v1/me/privacy-masking-settings");
        return envelope({ revision: 0, settings });
      }
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderCard();

    const enable = await screen.findByRole("switch", {
      name: i18n.t("settings.privacyMaskingEnabled"),
    });
    await user.click(enable);
    const words = screen.getByLabelText(
      i18n.t("settings.privacyMaskingWords")
    );
    await user.type(words, "Nightjar\n\nAcme");
    const save = screen.getByRole("button", {
      name: i18n.t("settings.privacyMaskingSave"),
    });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([, init]) => init?.method === "PUT"
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        expected_revision: 0,
        settings: {
          enabled: true,
          words: ["Nightjar", "Acme"],
        },
      });
    });
    expect(
      await screen.findByRole("switch", {
        name: i18n.t("settings.privacyMaskingEnabled"),
      })
    ).toBeChecked();
  });
});
