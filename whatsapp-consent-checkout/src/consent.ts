import type { NubeSDK, NubeSDKState } from "@tiendanube/nube-sdk-types";
import { Checkbox, Column } from "@tiendanube/nube-sdk-jsx";
import { isCheckoutPage } from "@tiendanube/nube-sdk-helper";

/**
 * Protocolo fixo gravado em order.extra — espelha exatamente as constantes
 * aceitas pelo backend (src/services/whatsappConsentService.ts). Qualquer
 * divergência aqui faz o CRM tratar o pedido como UNKNOWN (fail closed).
 */
export const CONSENT_MARKER_VERSION = "v1";
export const CONSENT_MARKER_SOURCE = "nuvemshop_checkout_whatsapp_optin";
export const CONSENT_MARKER_SCOPE = "marketing";

export const CONSENT_SESSION_KEY = "drosa_whatsapp_marketing_choice";

export const CONSENT_LABEL = "Quero receber novidades, ofertas e lembretes da D'Rosa Moda pelo WhatsApp.";

export type ConsentChoice = "granted" | "revoked";

export function isConsentChoice(value: unknown): value is ConsentChoice {
  return value === "granted" || value === "revoked";
}

/**
 * Monta o objeto completo a ser enviado via `order:add:extra`. O evento
 * SUBSTITUI o `order.extra` inteiro (não faz merge), mas nesta extensão essa
 * é a única gravação feita no pedido, então não há risco de apagar outras
 * chaves.
 */
export function buildConsentExtra(storeId: string | number, choice: ConsentChoice): Record<string, string> {
  return {
    drosa_whatsapp_marketing_version: CONSENT_MARKER_VERSION,
    drosa_whatsapp_marketing_store_id: String(storeId),
    drosa_whatsapp_marketing_source: CONSENT_MARKER_SOURCE,
    drosa_whatsapp_marketing_scope: CONSENT_MARKER_SCOPE,
    drosa_whatsapp_marketing_choice: choice,
  };
}

/** Renderiza a checkbox opcional (sempre desmarcada por padrão) no início do checkout. */
export function renderConsentCheckbox(nube: NubeSDK, checked: boolean): void {
  nube.render(
    "after_contact_form",
    Column({
      children: [
        Checkbox({
          name: "drosa_whatsapp_marketing_optin",
          label: CONSENT_LABEL,
          checked,
          onChange: ({ value }) => {
            const choice: ConsentChoice = value ? "granted" : "revoked";
            void nube.getBrowserAPIs().asyncSessionStorage.setItem(CONSENT_SESSION_KEY, choice);
          },
        }),
      ],
    }),
  );
}

/**
 * No sucesso do checkout, materializa em order.extra a decisão que o
 * cliente tomou explicitamente (se alguma). Se o cliente nunca interagiu com
 * a checkbox, nada é enviado — o backend nunca vê o marcador e o
 * classificador mantém o registro como UNKNOWN (nunca infere consentimento
 * a partir do silêncio do cliente).
 */
export async function writeConsentMarkerIfDecided(nube: NubeSDK): Promise<void> {
  const stored = await nube.getBrowserAPIs().asyncSessionStorage.getItem(CONSENT_SESSION_KEY);
  if (!isConsentChoice(stored)) return;

  const storeId = nube.getState().store.id;
  const extra = buildConsentExtra(storeId, stored);

  nube.send("order:add:extra", () => ({ order: { extra } }));
}

/** Reage a navegação/carregamento: renderiza a checkbox no início e grava o marcador no sucesso. */
export function handleLocationChange(nube: NubeSDK, state: Readonly<NubeSDKState>): void {
  const page = state.location.page;
  if (!isCheckoutPage(page)) return;

  if (page.data.step === "start") {
    void nube
      .getBrowserAPIs()
      .asyncSessionStorage.getItem(CONSENT_SESSION_KEY)
      .then((stored) => {
        renderConsentCheckbox(nube, stored === "granted");
      });
  }

  if (page.data.step === "success") {
    void writeConsentMarkerIfDecided(nube);
  }
}
