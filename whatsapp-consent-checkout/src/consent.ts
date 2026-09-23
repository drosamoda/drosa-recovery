import type { NubeSDK, NubeSDKState } from "@tiendanube/nube-sdk-types";
import { Checkbox, Column } from "@tiendanube/nube-sdk-jsx";
import { isCheckoutPage } from "@tiendanube/nube-sdk-helper";

/**
 * Protocolo fixo gravado em order.extra — espelha exatamente as constantes
 * aceitas pelo backend (src/services/whatsappConsentService.ts). Qualquer
 * divergência aqui faz o CRM tratar o respectivo escopo como UNKNOWN.
 */
export const CONSENT_MARKER_VERSION = "v1";
export const CONSENT_MARKER_SOURCE = "nuvemshop_checkout_whatsapp_optin";

export const MARKETING_CONSENT_SCOPE = "marketing";
export const TRANSACTIONAL_CONSENT_SCOPE = "transactional";

export const MARKETING_CONSENT_SESSION_KEY = "drosa_whatsapp_marketing_choice";
export const TRANSACTIONAL_CONSENT_SESSION_KEY = "drosa_whatsapp_transactional_choice";

export const MARKETING_CONSENT_LABEL =
  "Quero receber ofertas, novidades e lembretes de carrinho da D'Rosa Moda pelo WhatsApp.";
export const TRANSACTIONAL_CONSENT_LABEL =
  "Quero receber atualizações sobre meu pedido da D'Rosa Moda pelo WhatsApp.";

// Aliases v1 de marketing preservados para compatibilidade com testes/imports existentes.
export const CONSENT_MARKER_SCOPE = MARKETING_CONSENT_SCOPE;
export const CONSENT_SESSION_KEY = MARKETING_CONSENT_SESSION_KEY;
export const CONSENT_LABEL = MARKETING_CONSENT_LABEL;

export type ConsentChoice = "granted" | "revoked";
export type ConsentScope =
  | typeof MARKETING_CONSENT_SCOPE
  | typeof TRANSACTIONAL_CONSENT_SCOPE;
export type ConsentDecisions = Partial<Record<ConsentScope, ConsentChoice>>;

export function isConsentChoice(value: unknown): value is ConsentChoice {
  return value === "granted" || value === "revoked";
}

/**
 * Monta um marcador de consentimento sem apagar order.extra de terceiros.
 * order:add:extra substitui o objeto inteiro; por isso sempre preservamos
 * existingExtra e aplicamos apenas as chaves do escopo informado por cima.
 */
export function buildConsentExtra(
  existingExtra: Record<string, string> | undefined,
  storeId: string | number,
  choice: ConsentChoice,
  scope: ConsentScope = MARKETING_CONSENT_SCOPE,
): Record<string, string> {
  const prefix = `drosa_whatsapp_${scope}`;
  return {
    ...(existingExtra ?? {}),
    [`${prefix}_version`]: CONSENT_MARKER_VERSION,
    [`${prefix}_store_id`]: String(storeId),
    [`${prefix}_source`]: CONSENT_MARKER_SOURCE,
    [`${prefix}_scope`]: scope,
    [`${prefix}_choice`]: choice,
  };
}

export function buildConsentExtraForDecisions(
  existingExtra: Record<string, string> | undefined,
  storeId: string | number,
  decisions: ConsentDecisions,
): Record<string, string> {
  let next = { ...(existingExtra ?? {}) };

  const transactional = decisions[TRANSACTIONAL_CONSENT_SCOPE];
  if (transactional) {
    next = buildConsentExtra(next, storeId, transactional, TRANSACTIONAL_CONSENT_SCOPE);
  }

  const marketing = decisions[MARKETING_CONSENT_SCOPE];
  if (marketing) {
    next = buildConsentExtra(next, storeId, marketing, MARKETING_CONSENT_SCOPE);
  }

  return next;
}

/** Renderiza os dois opt-ins opcionais, ambos desmarcados por padrão. */
export function renderConsentCheckbox(
  nube: NubeSDK,
  marketingChecked: boolean,
  transactionalChecked = false,
): void {
  nube.render(
    "after_contact_form",
    Column({
      children: [
        Checkbox({
          name: "drosa_whatsapp_transactional_optin",
          label: TRANSACTIONAL_CONSENT_LABEL,
          checked: transactionalChecked,
          onChange: ({ value }) => {
            const choice: ConsentChoice = value ? "granted" : "revoked";
            void nube
              .getBrowserAPIs()
              .asyncSessionStorage.setItem(TRANSACTIONAL_CONSENT_SESSION_KEY, choice);
          },
        }),
        Checkbox({
          name: "drosa_whatsapp_marketing_optin",
          label: MARKETING_CONSENT_LABEL,
          checked: marketingChecked,
          onChange: ({ value }) => {
            const choice: ConsentChoice = value ? "granted" : "revoked";
            void nube
              .getBrowserAPIs()
              .asyncSessionStorage.setItem(MARKETING_CONSENT_SESSION_KEY, choice);
          },
        }),
      ],
    }),
  );
}

// Por instância de NubeSDK, no máximo um order:add:extra no sucesso.
const sentForInstance = new WeakSet<NubeSDK>();

/**
 * No sucesso do checkout, materializa somente decisões explícitas/persistidas.
 * Escopo ausente continua UNKNOWN no backend.
 */
export async function writeConsentMarkerIfDecided(nube: NubeSDK): Promise<void> {
  if (sentForInstance.has(nube)) return;
  sentForInstance.add(nube);

  const storage = nube.getBrowserAPIs().asyncSessionStorage;
  const [marketingStored, transactionalStored] = await Promise.all([
    storage.getItem(MARKETING_CONSENT_SESSION_KEY),
    storage.getItem(TRANSACTIONAL_CONSENT_SESSION_KEY),
  ]);

  const decisions: ConsentDecisions = {};
  if (isConsentChoice(marketingStored)) {
    decisions[MARKETING_CONSENT_SCOPE] = marketingStored;
  }
  if (isConsentChoice(transactionalStored)) {
    decisions[TRANSACTIONAL_CONSENT_SCOPE] = transactionalStored;
  }

  if (Object.keys(decisions).length === 0) return;

  const storeId = nube.getState().store.id;
  nube.send("order:add:extra", (state) => ({
    order: {
      extra: buildConsentExtraForDecisions(
        state.order?.extra,
        storeId,
        decisions,
      ),
    },
  }));
}

/** Reage a navegação/carregamento: renderiza no início e grava no sucesso. */
export function handleLocationChange(
  nube: NubeSDK,
  state: Readonly<NubeSDKState>,
): void {
  const page = state.location.page;
  if (!isCheckoutPage(page)) return;

  if (page.data.step === "start") {
    const storage = nube.getBrowserAPIs().asyncSessionStorage;
    void Promise.all([
      storage.getItem(MARKETING_CONSENT_SESSION_KEY),
      storage.getItem(TRANSACTIONAL_CONSENT_SESSION_KEY),
    ]).then(([marketingStored, transactionalStored]) => {
      renderConsentCheckbox(
        nube,
        marketingStored === "granted",
        transactionalStored === "granted",
      );
    });
  }

  if (page.data.step === "success") {
    void writeConsentMarkerIfDecided(nube);
  }
}
