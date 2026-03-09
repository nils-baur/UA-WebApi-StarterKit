// SendAASRequest.ts
import { IRequestMessage } from "../service/IRequestMessage";
import { HandleFactory } from "../service/HandleFactory";
import { SessionContext } from "../SessionContext";

export async function sendAASRequest<T = any>(
    session: React.ContextType<typeof SessionContext>,
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: any
): Promise<T> {
    const requestHandle = HandleFactory.increment();

    const defaultAASServerUrl = `ws://${location.host}/stream`;
    if (!session.serverUrl && session.setServerUrl) {
        console.log(`[AAS] Setting default WebSocket URL: ${defaultAASServerUrl}`);
        session.setServerUrl(defaultAASServerUrl);
    }

    const message: IRequestMessage = {
        ServiceId: "AASRequest",
        Body: {
            RequestHeader: { AASRequestHandle: requestHandle },
            Method: method,
            Path: path,
            Body: body,
        },
    };

    if (session.isConnected && typeof session.sendRequest === "function") {
        console.log(`[AAS] WS sending: ${method} ${path}`);
        session.sendRequest(message, requestHandle);

        // Poll lastCompletedRequest until we get a matching response
        return new Promise<T>((resolve, reject) => {
            session.addAASResponseListener?.(requestHandle, (response) => {
                const result = response.Body?.Result;
                if (result !== undefined) {
                    resolve(result as T);
                } else {
                    reject(new Error("AAS response missing result"));
                }
            });

            console.log(`[AAS] WS sending: ${method} ${path}`);
            session.sendRequest(message, requestHandle);
        });
    }

    // REST fallback
    console.log(`[AAS] REST fallback: ${method} ${path}`);
    const res = await fetch(`/api/v3.0${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
    }

    return res.json();
}
