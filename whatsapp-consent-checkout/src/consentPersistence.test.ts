import { describe, expect, it, vi } from "vitest";
import type { NubeSDK, NubeSDKState } from "@tiendanube/nube-sdk-types";
import {
	CART_ID_SESSION_KEY,
	MARKETING_CONSENT_SCOPE,
	MARKETING_CONSENT_SESSION_KEY,
	TRANSACTIONAL_CONSENT_SCOPE,
	TRANSACTIONAL_CONSENT_SESSION_KEY,
	finalizeConsentOnSuccess,
	handleCheckoutProgress,
	handleLocationChange,
	recordConsentDecision,
	syncConsentExtra,
} from "./consent";

type Extra = Record<string, string> | undefined;

// SDK com sessionStorage REAL (Map) e carrinho configurável: permite testar persistência,
// reload e vazamento entre checkouts.
function statefulSdk(opts: { cartId?: string; extra?: Extra; storage?: Map<string, string> } = {}) {
	const storage = opts.storage ?? new Map<string, string>();
	const state = { cartId: opts.cartId ?? "cart_A", extra: opts.extra as Extra };
	const send = vi.fn();
	const render = vi.fn();
	const nube = {
		render,
		send,
		getState: () =>
			({ store: { id: 7716231 }, cart: { id: state.cartId }, order: state.extra === undefined ? undefined : { extra: state.extra } }) as unknown as ReturnType<NubeSDK["getState"]>,
		getBrowserAPIs: () => ({
			asyncSessionStorage: {
				getItem: vi.fn(async (k: string) => storage.get(k) ?? null),
				setItem: vi.fn(async (k: string, v: string) => void storage.set(k, v)),
				removeItem: vi.fn(async (k: string) => void storage.delete(k)),
			},
		}),
	} as unknown as NubeSDK;
	return { nube, send, render, storage, state };
}

const checkoutState = (step: "start" | "payment" | "success") =>
	({ location: { page: { type: "checkout", data: { step } } } }) as unknown as Readonly<NubeSDKState>;

function extraOf(send: ReturnType<typeof vi.fn>, call: number, current: Extra = undefined): Record<string, string> {
	const modifier = send.mock.calls[call][1] as (s: unknown) => { order: { extra: Record<string, string> } };
	return modifier({ order: current === undefined ? undefined : { extra: current } }).order.extra;
}

describe("H2-persistence: decisão é despachada ANTES do sucesso", () => {
	it("A. transactional marcado → order:add:extra imediato (sem esperar success)", async () => {
		const { nube, send } = statefulSdk();
		await recordConsentDecision(nube, TRANSACTIONAL_CONSENT_SCOPE, "granted");

		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0][0]).toBe("order:add:extra");
		const extra = extraOf(send, 0);
		expect(extra.drosa_whatsapp_transactional_choice).toBe("granted");
	});

	it("B. marketing nunca tocado → nenhuma decisão de marketing inventada", async () => {
		const { nube, send } = statefulSdk();
		await recordConsentDecision(nube, TRANSACTIONAL_CONSENT_SCOPE, "granted");
		const extra = extraOf(send, 0);
		expect(Object.keys(extra).some((k) => k.startsWith("drosa_whatsapp_marketing"))).toBe(false);
	});

	it("C. transactional e depois marketing → segundo send com os dois escopos", async () => {
		const { nube, send } = statefulSdk();
		await recordConsentDecision(nube, TRANSACTIONAL_CONSENT_SCOPE, "granted");
		await recordConsentDecision(nube, MARKETING_CONSENT_SCOPE, "granted");

		expect(send).toHaveBeenCalledTimes(2);
		const extra = extraOf(send, 1);
		expect(extra.drosa_whatsapp_transactional_choice).toBe("granted");
		expect(extra.drosa_whatsapp_marketing_choice).toBe("granted");
	});

	it("D. marketing granted → revoked gera NOVO send (não é bloqueado como o antigo WeakSet)", async () => {
		const { nube, send } = statefulSdk();
		await recordConsentDecision(nube, MARKETING_CONSENT_SCOPE, "granted");
		await recordConsentDecision(nube, MARKETING_CONSENT_SCOPE, "revoked");

		expect(send).toHaveBeenCalledTimes(2);
		expect(extraOf(send, 1).drosa_whatsapp_marketing_choice).toBe("revoked");
	});

	it("E. mesma decisão repetida (eventos ready/order/payment) não duplica o send", async () => {
		const { nube, send } = statefulSdk();
		await recordConsentDecision(nube, TRANSACTIONAL_CONSENT_SCOPE, "granted");
		handleCheckoutProgress(nube, checkoutState("payment"));
		handleCheckoutProgress(nube, checkoutState("payment"));
		await syncConsentExtra(nube);
		await syncConsentExtra(nube);

		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
	});

	it("E2. se o pedido JÁ contém exatamente os marcadores, não reenvia", async () => {
		const first = statefulSdk();
		await recordConsentDecision(first.nube, TRANSACTIONAL_CONSENT_SCOPE, "granted");
		const applied = extraOf(first.send, 0);

		const { nube, send } = statefulSdk({ storage: first.storage, extra: applied });
		await syncConsentExtra(nube);
		expect(send).not.toHaveBeenCalled();
	});

	it("F. reload do mesmo checkout: decisão restaurada, checkbox marcada e re-materializada", async () => {
		const first = statefulSdk();
		await recordConsentDecision(first.nube, TRANSACTIONAL_CONSENT_SCOPE, "granted");

		const reloaded = statefulSdk({ storage: first.storage }); // nova instância, mesma sessão/carrinho
		handleLocationChange(reloaded.nube, checkoutState("start"));
		await vi.waitFor(() => expect(reloaded.send).toHaveBeenCalledTimes(1));
		expect(reloaded.render).toHaveBeenCalledTimes(1);
		expect(extraOf(reloaded.send, 0).drosa_whatsapp_transactional_choice).toBe("granted");
	});

	it("G. novo checkout (outro carrinho) NÃO herda a decisão do pedido anterior", async () => {
		const a = statefulSdk({ cartId: "cart_A" });
		await recordConsentDecision(a.nube, TRANSACTIONAL_CONSENT_SCOPE, "granted");

		const b = statefulSdk({ cartId: "cart_B", storage: a.storage });
		await syncConsentExtra(b.nube);
		expect(b.send).not.toHaveBeenCalled();
		expect(b.storage.has(TRANSACTIONAL_CONSENT_SESSION_KEY)).toBe(false);
	});

	it("H. success: fallback garante a última decisão e limpa a sessão", async () => {
		const { nube, send, storage } = statefulSdk();
		await recordConsentDecision(nube, TRANSACTIONAL_CONSENT_SCOPE, "granted");
		send.mockClear();

		handleLocationChange(nube, checkoutState("success"));
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
		expect(extraOf(send, 0).drosa_whatsapp_transactional_choice).toBe("granted");
		await vi.waitFor(() => expect(storage.size).toBe(0));
	});

	it("H2. success repetido não reenvia e sem decisão não envia nada", async () => {
		const { nube, send } = statefulSdk();
		await finalizeConsentOnSuccess(nube);
		expect(send).not.toHaveBeenCalled();

		await recordConsentDecision(nube, TRANSACTIONAL_CONSENT_SCOPE, "granted");
		send.mockClear();
		await finalizeConsentOnSuccess(nube);
		await finalizeConsentOnSuccess(nube);
		expect(send).toHaveBeenCalledTimes(1);
	});

	it("I. preserva chaves de outros apps presentes em state.order.extra no momento do envio", async () => {
		const { nube, send } = statefulSdk({ extra: { attribution_source: "google" } });
		await recordConsentDecision(nube, TRANSACTIONAL_CONSENT_SCOPE, "granted");
		const extra = extraOf(send, 0, { attribution_source: "google", another: "x" });
		expect(extra.attribution_source).toBe("google");
		expect(extra.another).toBe("x");
		expect(extra.drosa_whatsapp_transactional_choice).toBe("granted");
	});

	it("J. objeto final é Record<string,string> plano", async () => {
		const { nube, send } = statefulSdk();
		await recordConsentDecision(nube, TRANSACTIONAL_CONSENT_SCOPE, "granted");
		await recordConsentDecision(nube, MARKETING_CONSENT_SCOPE, "revoked");
		for (const value of Object.values(extraOf(send, 1))) expect(typeof value).toBe("string");
	});

	it("persiste o id do carrinho junto da decisão e as chaves da sessão são as esperadas", async () => {
		const { nube, storage } = statefulSdk({ cartId: "cart_X" });
		await recordConsentDecision(nube, MARKETING_CONSENT_SCOPE, "granted");
		expect(storage.get(MARKETING_CONSENT_SESSION_KEY)).toBe("granted");
		expect(storage.get(CART_ID_SESSION_KEY)).toBe("cart_X");
	});
});
