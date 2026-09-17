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

function fakeSdk(overrides: Partial<{ getItem: unknown; storeId: number }> = {}) {
	const getItem = vi.fn().mockResolvedValue(overrides.getItem ?? null);
	const setItem = vi.fn().mockResolvedValue(undefined);
	const render = vi.fn();
	const send = vi.fn();
	const getState = vi.fn(
		() =>
			({
				store: { id: overrides.storeId ?? 7716231 },
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
	it("gera exatamente o protocolo fixo aceito pelo backend", () => {
		expect(buildConsentExtra(7716231, "granted")).toEqual({
			drosa_whatsapp_marketing_version: CONSENT_MARKER_VERSION,
			drosa_whatsapp_marketing_store_id: "7716231",
			drosa_whatsapp_marketing_source: CONSENT_MARKER_SOURCE,
			drosa_whatsapp_marketing_scope: CONSENT_MARKER_SCOPE,
			drosa_whatsapp_marketing_choice: "granted",
		});
	})

	it("sempre serializa store_id como string", () => {
		const extra = buildConsentExtra(123, "revoked");
		expect(extra.drosa_whatsapp_marketing_store_id).toBe("123");
		expect(extra.drosa_whatsapp_marketing_choice).toBe("revoked");
	});
});

describe("writeConsentMarkerIfDecided", () => {
	beforeEach(() => vi.clearAllMocks());

	it("nunca envia order:add:extra quando o cliente nunca interagiu com a checkbox", async () => {
		const { nube, getItem, send } = fakeSdk({ getItem: null });

		await writeConsentMarkerIfDecided(nube);

		expect(getItem).toHaveBeenCalledWith(CONSENT_SESSION_KEY);
		expect(send).not.toHaveBeenCalled();
	});

	it("ignora valor de sessão corrompido/inesperado", async () => {
		const { nube, send } = fakeSdk({ getItem: "yes" });

		await writeConsentMarkerIfDecided(nube);

		expect(send).not.toHaveBeenCalled();
	});

	it("envia order:add:extra com choice=granted quando a sessão registrou opt-in", async () => {
		const { nube, send } = fakeSdk({ getItem: "granted", storeId: 7716231 });

		await writeConsentMarkerIfDecided(nube);

		expect(send).toHaveBeenCalledTimes(1);
		const [event, modifier] = send.mock.calls[0];
		expect(event).toBe("order:add:extra");
		expect(modifier(undefined as never)).toEqual({
			order: { extra: buildConsentExtra(7716231, "granted") },
		});
	});

	it("envia order:add:extra com choice=revoked quando a sessão registrou revogação explícita", async () => {
		const { nube, send } = fakeSdk({ getItem: "revoked", storeId: 7716231 });

		await writeConsentMarkerIfDecided(nube);

		const [, modifier] = send.mock.calls[0];
		expect(modifier(undefined as never)).toEqual({
			order: { extra: buildConsentExtra(7716231, "revoked") },
		});
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
});
