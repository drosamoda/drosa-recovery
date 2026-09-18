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
 * Monta o objeto completo a ser enviado via `order:add:extra`. Confirmado na
 * documentação oficial (dev.tiendanube.com/docs/applications/nube-sdk/events/order):
 * "The event replaces the entire `extra` object each time it is sent — it
 * does not deep-merge." Ou seja, QUALQUER outro app (attribution, upsell,
 * etc.) que já tenha gravado algo em `order.extra` seria apagado se
 * enviássemos só o marcador D'Rosa. Por isso `existingExtra` (lido de
 * `state.order?.extra` no momento do envio — ver `writeConsentMarkerIfDecided`)
 * é espalhado PRIMEIRO, e as 5 chaves fixas do marcador D'Rosa são aplicadas
 * por cima, sempre por último — preservando qualquer chave que não pertença
 * a este protocolo, e garantindo que o marcador D'Rosa nunca seja
 * sobrescrito por um valor antigo.
 */
export function buildConsentExtra(
  existingExtra: Record<string, string> | undefined,
  storeId: string | number,
  choice: ConsentChoice,
): Record<string, string> {
  return {
    ...(existingExtra ?? {}),
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

// Proteção contra reenvio/loop: por instância de NubeSDK (ou seja, por
// carregamento de página/worker — uma nova instância nasce a cada
// page:loaded real), no máximo um `order:add:extra` é enviado por esta
// extensão. Necessário porque `handleLocationChange` reage tanto a
// `page:loaded` quanto a `location:updated`, e nada garante que
// `location:updated` dispare no máximo uma vez com step="success" (ex.:
// mudança de querystring/hash na mesma página). A documentação oficial não
// especifica se `send("order:add:extra")` pode re-disparar o listener
// `order:update` de volta para esta própria app — por isso esta extensão
// deliberadamente NUNCA escuta `order:update` (só `page:loaded`/
// `location:updated`, em main.tsx), o que já elimina esse caminho de loop
// por construção; este WeakSet é uma segunda camada, independente, contra
// qualquer reentrância pelo caminho que de fato usamos.
const sentForInstance = new WeakSet<NubeSDK>();

/**
 * No sucesso do checkout, materializa em order.extra a decisão que o
 * cliente tomou explicitamente (se alguma). Se o cliente nunca interagiu com
 * a checkbox, nada é enviado — o backend nunca vê o marcador e o
 * classificador mantém o registro como UNKNOWN (nunca infere consentimento
 * a partir do silêncio do cliente).
 */
export async function writeConsentMarkerIfDecided(nube: NubeSDK): Promise<void> {
  // Reivindica a instância de forma SÍNCRONA, antes de qualquer `await` —
  // fecha a janela de corrida entre chamadas concorrentes (ex.:
  // `location:updated` disparando mais de uma vez seguida enquanto ainda na
  // etapa success): se a verificação e a marcação acontecessem depois do
  // `await` abaixo, todas as chamadas concorrentes veriam `sentForInstance`
  // vazio ao mesmo tempo e cada uma enviaria seu próprio order:add:extra.
  if (sentForInstance.has(nube)) return;
  sentForInstance.add(nube);

  const stored = await nube.getBrowserAPIs().asyncSessionStorage.getItem(CONSENT_SESSION_KEY);
  if (!isConsentChoice(stored)) return;

  const storeId = nube.getState().store.id;
  // O modifier recebe o state MAIS FRESCO no momento do envio (não o lido
  // antes do await acima) — é a única forma documentada de ler
  // order.extra já existente (de outro app) antes de decidir o que enviar,
  // já que order:add:extra substitui o objeto inteiro em vez de fazer merge.
  nube.send("order:add:extra", (state) => ({
    order: { extra: buildConsentExtra(state.order?.extra, storeId, stored) },
  }));
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
