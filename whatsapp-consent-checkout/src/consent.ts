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
export const CART_ID_SESSION_KEY = "drosa_whatsapp_consent_cart_id";

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
            void recordConsentDecision(nube, TRANSACTIONAL_CONSENT_SCOPE, value ? "granted" : "revoked");
          },
        }),
        Checkbox({
          name: "drosa_whatsapp_marketing_optin",
          label: MARKETING_CONSENT_LABEL,
          checked: marketingChecked,
          onChange: ({ value }) => {
            void recordConsentDecision(nube, MARKETING_CONSENT_SCOPE, value ? "granted" : "revoked");
          },
        }),
      ],
    }),
  );
}

const ALL_SESSION_KEYS = [
  MARKETING_CONSENT_SESSION_KEY,
  TRANSACTIONAL_CONSENT_SESSION_KEY,
  CART_ID_SESSION_KEY,
];

function sessionKeyForScope(scope: ConsentScope): string {
  return scope === TRANSACTIONAL_CONSENT_SCOPE
    ? TRANSACTIONAL_CONSENT_SESSION_KEY
    : MARKETING_CONSENT_SESSION_KEY;
}

function currentCartId(nube: NubeSDK): string | null {
  const id = (nube.getState() as { cart?: { id?: unknown } }).cart?.id;
  return typeof id === "string" && id ? id : null;
}

export async function clearConsentSession(nube: NubeSDK): Promise<void> {
  const storage = nube.getBrowserAPIs().asyncSessionStorage;
  await Promise.all(ALL_SESSION_KEYS.map((key) => storage.removeItem(key)));
}

/**
 * Lê as decisões EXPLÍCITAS da sessão. Decisão guardada para OUTRO carrinho/checkout
 * é descartada (nunca herdar o consentimento de um pedido anterior). Escopo nunca
 * tocado fica ausente: o backend o trata como UNKNOWN (silêncio não vira "revoked").
 */
export async function readConsentDecisions(nube: NubeSDK): Promise<ConsentDecisions> {
  const storage = nube.getBrowserAPIs().asyncSessionStorage;
  const [marketingStored, transactionalStored, storedCart] = await Promise.all([
    storage.getItem(MARKETING_CONSENT_SESSION_KEY),
    storage.getItem(TRANSACTIONAL_CONSENT_SESSION_KEY),
    storage.getItem(CART_ID_SESSION_KEY),
  ]);

  const cartId = currentCartId(nube);
  if (storedCart && cartId && storedCart !== cartId) {
    await clearConsentSession(nube);
    return {};
  }

  const decisions: ConsentDecisions = {};
  if (isConsentChoice(marketingStored)) decisions[MARKETING_CONSENT_SCOPE] = marketingStored;
  if (isConsentChoice(transactionalStored)) decisions[TRANSACTIONAL_CONSENT_SCOPE] = transactionalStored;
  return decisions;
}

function fingerprint(decisions: ConsentDecisions): string {
  return `${decisions[TRANSACTIONAL_CONSENT_SCOPE] ?? "-"}|${decisions[MARKETING_CONSENT_SCOPE] ?? "-"}`;
}

// Deduplicação por ESTADO da decisão (não "um envio por instância"): mudar a decisão
// gera novo order:add:extra; repetir a mesma decisão não reenvia.
const dispatchedPre = new WeakMap<NubeSDK, Set<string>>();
const dispatchedFinal = new WeakMap<NubeSDK, Set<string>>();

function alreadyMaterialized(
  current: Record<string, string> | undefined,
  next: Record<string, string>,
): boolean {
  const drosaKeys = Object.keys(next).filter((key) => key.startsWith("drosa_whatsapp_"));
  return drosaKeys.length > 0 && drosaKeys.every((key) => current?.[key] === next[key]);
}

function dispatchExtra(nube: NubeSDK, decisions: ConsentDecisions): void {
  const storeId = nube.getState().store.id;
  // order:add:extra SUBSTITUI o objeto extra inteiro: sempre parte de state.order.extra
  // atual (lido no momento do envio) para preservar metadata de outros apps.
  nube.send("order:add:extra", (state) => ({
    order: {
      extra: buildConsentExtraForDecisions(state.order?.extra, storeId, decisions),
    },
  }));
}

/**
 * Materializa as decisões em order.extra ANTES de o pedido ser concluído (a página de
 * sucesso é tarde demais: o pedido já foi criado e o webhook já saiu sem extra).
 * Idempotente: não reenvia a mesma decisão nem quando o pedido já a contém.
 */
export async function syncConsentExtra(nube: NubeSDK): Promise<void> {
  const decisions = await readConsentDecisions(nube);
  if (Object.keys(decisions).length === 0) return;

  const fp = fingerprint(decisions);
  const sent = dispatchedPre.get(nube) ?? new Set<string>();
  if (sent.has(fp)) return;
  sent.add(fp);
  dispatchedPre.set(nube, sent);

  const storeId = nube.getState().store.id;
  const current = nube.getState().order?.extra;
  if (alreadyMaterialized(current, buildConsentExtraForDecisions(current, storeId, decisions))) return;

  dispatchExtra(nube, decisions);
}

/** Registra uma escolha explícita (onChange) e materializa imediatamente. */
export async function recordConsentDecision(
  nube: NubeSDK,
  scope: ConsentScope,
  choice: ConsentChoice,
): Promise<void> {
  const storage = nube.getBrowserAPIs().asyncSessionStorage;
  await storage.setItem(sessionKeyForScope(scope), choice);
  const cartId = currentCartId(nube);
  if (cartId) await storage.setItem(CART_ID_SESSION_KEY, cartId);
  await syncConsentExtra(nube);
}

/**
 * Fallback no sucesso: garante a última decisão uma vez e limpa a sessão para que o
 * próximo checkout não herde nada. Reconciliação, nunca o único caminho.
 */
export async function finalizeConsentOnSuccess(nube: NubeSDK): Promise<void> {
  const decisions = await readConsentDecisions(nube);
  if (Object.keys(decisions).length === 0) return;

  const fp = fingerprint(decisions);
  const sent = dispatchedFinal.get(nube) ?? new Set<string>();
  if (sent.has(fp)) return;
  sent.add(fp);
  dispatchedFinal.set(nube, sent);

  dispatchExtra(nube, decisions);
  await clearConsentSession(nube);
}

/** Mantido por compatibilidade: equivale ao fallback de sucesso. */
export async function writeConsentMarkerIfDecided(nube: NubeSDK): Promise<void> {
  await finalizeConsentOnSuccess(nube);
}

/** Reage a navegação/carregamento: renderiza e re-materializa no início; fallback no sucesso. */
export function handleLocationChange(
  nube: NubeSDK,
  state: Readonly<NubeSDKState>,
): void {
  const page = state.location.page;
  if (!isCheckoutPage(page)) return;

  if (page.data.step === "start") {
    void readConsentDecisions(nube).then((decisions) => {
      renderConsentCheckbox(
        nube,
        decisions[MARKETING_CONSENT_SCOPE] === "granted",
        decisions[TRANSACTIONAL_CONSENT_SCOPE] === "granted",
      );
      // Recarga do mesmo checkout: a decisão restaurada volta a ser materializada.
      void syncConsentExtra(nube);
    });
  }

  if (page.data.step === "success") {
    void finalizeConsentOnSuccess(nube);
  }
}

/** Eventos do checkout antes da conclusão (ready/order/payment): só re-sincroniza. */
export function handleCheckoutProgress(
  nube: NubeSDK,
  state: Readonly<NubeSDKState>,
): void {
  const page = state.location.page;
  if (!isCheckoutPage(page) || page.data.step === "success") return;
  void syncConsentExtra(nube);
}
