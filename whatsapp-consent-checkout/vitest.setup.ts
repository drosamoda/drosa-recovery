// NubeSDK components (@tiendanube/nube-sdk-ui) assume a Web Worker global
// scope (`self`) at runtime, with `self.__APP_DATA__.id` injected by the
// Nuvemshop host. Node's test environment provides neither.
type WorkerGlobal = { self?: { __APP_DATA__?: { id: string; script: string } } };

if (typeof (globalThis as WorkerGlobal).self === "undefined") {
	(globalThis as WorkerGlobal).self = globalThis as never;
}

const workerSelf = (globalThis as WorkerGlobal).self;
if (workerSelf && !workerSelf.__APP_DATA__) {
	workerSelf.__APP_DATA__ = { id: "test-app", script: "" };
}
