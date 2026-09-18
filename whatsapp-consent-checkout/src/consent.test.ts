import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NubeSDK, NubeSDKState } from "@tiendanube/nube-sdk-types";
import {
	buildConsentExtra,
	CONSENT_MARKER_SCOPE,
	CONSENT_MARKER_SOURCE,
	CONSENT_MARKER_VERSION,
	CONSENT_SESSION_KEY,
	handleLocationChange,
	isConsentChoice,
	writeConsentMarkerIfDecided,
} from "./consent";

function fakeSdk(overrides: Partial<{ getItem: unknown; storeId: number; existingExtra: Record<string, string> | undefined }> = {}) {
	const getItem = vi.fn().mockResolvedValue(overrides.getItem ?? null);
	const setItem = vi.fn().mockResolvedValue(undefined);
	const render = vi.fn();
	const send = vi.fn();
	const getState = vi.fn(
		() =>
			({
				store: { id: overrides.storeId ?? 7716231 },
				order: overrides.existingExtra === undefined ? undefined : { extra: overrides.existingExtra },
			}) as unknown as ReturnType<NubeSDK["getState"]>,
	);

	const nube = {
		render,
		send,
		getState,
		getBrowserAPIs: () => ({
			asyncSessionStorage: { getItem, setItem, removeItem: vi.fn() },
			asyncLocalStorage: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
			navigate: vi.fn(),
			postMessageToIframe: vi.fn(),
			submitForm: vi.fn(),
			resetForm: vi.fn(),
			scrollTo: vi.fn(),
		}),
	} as unknown as NubeSDK;

	return { nube, getItem, setItem, render, send, getState };
}

function checkoutState(step: "start" | "payment" | "success"): Readonly<NubeSDKState> {
	return {
		location: { page: { type: "checkout", data: { step } }, url: "", queries: {}, title: "", referrer: null },
	} as unknown as NubeSDKState;
}

// Simula o comportamento real do host: o modifier passado a send() recebe o
// state atual (com order.extra, se houver) — nunca `undefined`.
function callModifier(send: ReturnType<typeof vi.fn>, order: { extra?: Record<string, string> } | undefined) {
	const [, modifier] = send.mock.calls[0];
	return modifier({ order } as unknown as Readonly<NubeSDKState>);
}

describe("isConsentChoice", () => {
	it.each([
		["granted", true],
		["revoked", true],
		["maybe", false],
		[null, false],
		[undefined, false],
		["", false],
	])("classifies %j as %s", (value, expected) => {
		expect(isConsentChoice(value)).toBe(expected);
	});
});

describe("buildConsentExtra", () => {
	it("gera exatamente o protocolo fixo aceito pelo backend quando não há order.extra prévio", () => {
		expect(buildConsentExtra(undefined, 7716231, "granted")).toEqual({
			drosa_whatsapp_marketing_version: CONSENT_MARKER_VERSION,
			drosa_whatsapp_marketing_store_id: "7716231",
			drosa_whatsapp_marketing_source: CONSENT_MARKER_SOURCE,
			drosa_whatsapp_marketing_scope: CONSENT_MARKER_SCOPE,
			drosa_whatsapp_marketing_choice: "granted",
		});
	});

	it("sempre serializa store_id como string", () => {
		const extra = buildConsentExtra(undefined, 123, "revoked");
		expect(extra.drosa_whatsapp_marketing_store_id).toBe("123");
		expect(extra.drosa_whatsapp_marketing_choice).toBe("revoked");
	});

	// 1) preserva metadata existente de outros apps, e 9) byte-for-byte.
	it("preserva TODAS as chaves de order.extra já existentes (de outros apps), inalteradas", () => {
		const existing = { attribution_source: "google", another_app_key: "abc" };
		const result = buildConsentExtra(existing, 7716231, "granted");

		expect(result.attribution_source).toBe("google");
		expect(result.another_app_key).toBe("abc");
		expect(result).toEqual({
			attribution_source: "google",
			another_app_key: "abc",
			drosa_whatsapp_marketing_version: CONSENT_MARKER_VERSION,
			drosa_whatsapp_marketing_store_id: "7716231",
			drosa_whatsapp_marketing_source: CONSENT_MARKER_SOURCE,
			drosa_whatsapp_marketing_scope: CONSENT_MARKER_SCOPE,
			drosa_whatsapp_marketing_choice: "granted",
		});
	});

	// 5) order.extra ausente (undefined) — não deve lançar, resultado é só o marcador.
	it("order.extra ausente (undefined): não lança, resultado contém só o marcador D'Rosa", () => {
		expect(buildConsentExtra(undefined, 7716231, "granted")).toEqual({
			drosa_whatsapp_marketing_version: CONSENT_MARKER_VERSION,
			drosa_whatsapp_marketing_store_id: "7716231",
			drosa_whatsapp_marketing_source: CONSENT_MARKER_SOURCE,
			drosa_whatsapp_marketing_scope: CONSENT_MARKER_SCOPE,
			drosa_whatsapp_marketing_choice: "granted",
		});
	});

	// 6) marker D'Rosa já existente (ex.: choice antigo de uma sessão anterior
	// que por algum motivo não foi limpo) — o valor NOVO sempre vence, nunca
	// fica um mix de campos velhos/novos do próprio marcador.
	it("marker D'Rosa já existente em order.extra é inteiramente substituído pelo novo, nunca misturado", () => {
		const existing = {
			drosa_whatsapp_marketing_version: "v1",
			drosa_whatsapp_marketing_store_id: "999999",
			drosa_whatsapp_marketing_source: CONSENT_MARKER_SOURCE,
			drosa_whatsapp_marketing_scope: CONSENT_MARKER_SCOPE,
			drosa_whatsapp_marketing_choice: "revoked",
		};
		const result = buildConsentExtra(existing, 7716231, "granted");

		expect(result.drosa_whatsapp_marketing_store_id).toBe("7716231");
		expect(result.drosa_whatsapp_marketing_choice).toBe("granted");
	});
});

describe("writeConsentMarkerIfDecided", () => {
	beforeEach(() => vi.clearAllMocks());

	// 4) sem interação explícita = zero send.
	it("nunca envia order:add:extra quando o cliente nunca interagiu com a checkbox", async () => {
		const { nube, getItem, send } = fakeSdk({ getItem: null });

		await writeConsentMarkerIfDecided(nube);

		expect(getItem).toHaveBeenCalledWith(CONSENT_SESSION_KEY);
		expect(send).not.toHaveBeenCalled();
	});

	// 8) choice inválido não grava.
	it("ignora valor de sessão corrompido/inesperado (choice inválido não grava)", async () => {
		const { nube, send } = fakeSdk({ getItem: "yes" });

		await writeConsentMarkerIfDecided(nube);

		expect(send).not.toHaveBeenCalled();
	});

	// 2) granted.
	it("envia order:add:extra com choice=granted quando a sessão registrou opt-in", async () => {
		const { nube, send } = fakeSdk({ getItem: "granted", storeId: 7716231 });

		await writeConsentMarkerIfDecided(nube);

		expect(send).toHaveBeenCalledTimes(1);
		const [event] = send.mock.calls[0];
		expect(event).toBe("order:add:extra");
		expect(callModifier(send, undefined)).toEqual({
			order: { extra: buildConsentExtra(undefined, 7716231, "granted") },
		});
	});

	// 3) revoked.
	it("envia order:add:extra com choice=revoked quando a sessão registrou revogação explícita", async () => {
		const { nube, send } = fakeSdk({ getItem: "revoked", storeId: 7716231 });

		await writeConsentMarkerIfDecided(nube);

		expect(callModifier(send, undefined)).toEqual({
			order: { extra: buildConsentExtra(undefined, 7716231, "revoked") },
		});
	});

	// 1) preserva metadata existente, lida via state.order.extra no momento
	// do envio (o modifier passado a send(), não um getState() antecipado).
	it("preserva order.extra existente de outro app — o resultado final inclui as chaves antigas + o marcador D'Rosa", async () => {
		const { nube, send } = fakeSdk({ getItem: "granted", storeId: 7716231 });

		await writeConsentMarkerIfDecided(nube);

		const existing = { attribution_source: "google", another_app_key: "abc" };
		expect(callModifier(send, { extra: existing })).toEqual({
			order: {
				extra: {
					attribution_source: "google",
					another_app_key: "abc",
					drosa_whatsapp_marketing_version: CONSENT_MARKER_VERSION,
					drosa_whatsapp_marketing_store_id: "7716231",
					drosa_whatsapp_marketing_source: CONSENT_MARKER_SOURCE,
					drosa_whatsapp_marketing_scope: CONSENT_MARKER_SCOPE,
					drosa_whatsapp_marketing_choice: "granted",
				},
			},
		});
	});

	// 5) order.extra ausente no state (order existe mas sem extra, ou order
	// nem existe ainda) — não deve lançar.
	it("order.extra ausente no state no momento do envio: não lança, resultado é só o marcador", async () => {
		const { nube, send } = fakeSdk({ getItem: "granted", storeId: 7716231 });

		await writeConsentMarkerIfDecided(nube);

		expect(() => callModifier(send, undefined)).not.toThrow();
		expect(callModifier(send, { extra: undefined })).toEqual({
			order: { extra: buildConsentExtra(undefined, 7716231, "granted") },
		});
	});

	// 7) execução repetida não gera loop / reenvio duplicado.
	it("chamadas repetidas para a MESMA instância de NubeSDK enviam order:add:extra no máximo uma vez", async () => {
		const { nube, send } = fakeSdk({ getItem: "granted", storeId: 7716231 });

		await writeConsentMarkerIfDecided(nube);
		await writeConsentMarkerIfDecided(nube);
		await writeConsentMarkerIfDecided(nube);

		expect(send).toHaveBeenCalledTimes(1);
	});

	it("instâncias DIFERENTES de NubeSDK (ex.: outro carregamento de página) não compartilham a proteção contra reenvio", async () => {
		const first = fakeSdk({ getItem: "granted", storeId: 7716231 });
		const second = fakeSdk({ getItem: "granted", storeId: 7716231 });

		await writeConsentMarkerIfDecided(first.nube);
		await writeConsentMarkerIfDecided(second.nube);

		expect(first.send).toHaveBeenCalledTimes(1);
		expect(second.send).toHaveBeenCalledTimes(1);
	});
});

describe("handleLocationChange", () => {
	beforeEach(() => vi.clearAllMocks());

	it("ignora páginas que não são de checkout", () => {
		const { nube, render, send } = fakeSdk();
		const nonCheckout = {
			location: { page: { type: "home", data: undefined }, url: "", queries: {}, title: "", referrer: null },
		} as unknown as NubeSDKState;

		handleLocationChange(nube, nonCheckout);

		expect(render).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});

	it("na etapa start, renderiza a checkbox desmarcada quando não há decisão salva", async () => {
		const { nube, render, getItem } = fakeSdk({ getItem: null });

		handleLocationChange(nube, checkoutState("start"));
		await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));

		expect(getItem).toHaveBeenCalledWith(CONSENT_SESSION_KEY);
		const [slot] = render.mock.calls[0];
		expect(slot).toBe("after_contact_form");
	});

	it("na etapa payment, não renderiza nem grava nada", () => {
		const { nube, render, send } = fakeSdk();

		handleLocationChange(nube, checkoutState("payment"));

		expect(render).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});

	it("na etapa success, grava o marcador quando há decisão salva", async () => {
		const { nube, send } = fakeSdk({ getItem: "granted" });

		handleLocationChange(nube, checkoutState("success"));
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));

		expect(send).toHaveBeenCalledWith("order:add:extra", expect.any(Function));
	});

	it("na etapa success, não grava nada quando o cliente nunca decidiu", async () => {
		const { nube, send, getItem } = fakeSdk({ getItem: null });

		handleLocationChange(nube, checkoutState("success"));
		await vi.waitFor(() => expect(getItem).toHaveBeenCalled());

		expect(send).not.toHaveBeenCalled();
	});

	// 7) execução repetida de handleLocationChange (ex.: location:updated
	// disparando mais de uma vez ainda na etapa success) não gera loop.
	it("handleLocationChange chamado repetidamente na etapa success envia order:add:extra no máximo uma vez", async () => {
		const { nube, send } = fakeSdk({ getItem: "granted" });

		handleLocationChange(nube, checkoutState("success"));
		handleLocationChange(nube, checkoutState("success"));
		handleLocationChange(nube, checkoutState("success"));
		await vi.waitFor(() => expect(send).toHaveBeenCalled());

		expect(send).toHaveBeenCalledTimes(1);
	});
});
