import * as React from 'react';
import * as OpcUa from 'opcua-webapi';
import { SubscriptionContext } from './SubscriptionContext';
import { IMonitoredItem } from './SubscriptionProvider';

export type publishCB = (...args: any[]) => void; // Adjust the signature as needed
export type LPVOID = any; // Use a more specific type if possible
export type subscriptionIDType = number; // Or string, depending on your implementation

// Type definitions (adjust as needed)
//type subscriptionParameters = any; // Replace with your actual type

const MAX_SUBSCRIPTIONS = 10; // Set to your actual max
const INVALID_SUBSCRIPTION_ID = -1;
const ERROR_NO_AVAILABLE_SUBSCRIPTION = -2;
let globalSubscriptionId = 1;

export interface subscriptionContext {
    subscriptionID: number;
    publishCB?: publishCB;
    publishCtx?: LPVOID;
}

// Simulated global subscription context array
const activeSubscriptions: subscriptionContext[] = Array.from({ length: MAX_SUBSCRIPTIONS }, () => ({
    subscriptionID: INVALID_SUBSCRIPTION_ID,
}));

export function handlePublishCallbackAPI(
    prm: OpcUa.PublishResponse,
    monitoredItems: Map<number, IMonitoredItem>,
): void {
    for (let i = 0; i < MAX_SUBSCRIPTIONS; i++) {
        if (activeSubscriptions[i].subscriptionID === prm.SubscriptionId) {
            activeSubscriptions[i].publishCB?.(prm, monitoredItems, activeSubscriptions[i].publishCtx);
            break;
        }
    }
}

export function createSubscriptionAPI(
    createSubscription: () => void,
    subscriptionRequest: subscriptionContext
): number {
    for (let i = 0; i < MAX_SUBSCRIPTIONS; i++) {
        if (activeSubscriptions[i].subscriptionID === INVALID_SUBSCRIPTION_ID) {
            activeSubscriptions[i].publishCB = subscriptionRequest.publishCB;
            activeSubscriptions[i].publishCtx = subscriptionRequest.publishCtx;
            activeSubscriptions[i].subscriptionID = globalSubscriptionId;
            subscriptionRequest.subscriptionID = globalSubscriptionId;
            globalSubscriptionId++;

            if (typeof createSubscription === "function") {
                createSubscription();
            }
            return 1;
        }
    }
    return ERROR_NO_AVAILABLE_SUBSCRIPTION;
}

export function addMonitoredItemAPI(
    addNewMonitoredItem: () => void,
    itemArray: IMonitoredItem[],
    subscriptionRequest: subscriptionContext
): number {
    for (let i = 0; i < MAX_SUBSCRIPTIONS; i++) {
        if (activeSubscriptions[i].subscriptionID === subscriptionRequest.subscriptionID) {
            if (typeof addNewMonitoredItem === "function") {
                addNewMonitoredItem(itemArray, subscriptionRequest.subscriptionID);
            }
            return 1;
        }
    }
    return ERROR_NO_AVAILABLE_SUBSCRIPTION;
}

export function removeMonitoredItemAPI(
    removeMonitoredItem: () => void,
    itemArray: IMonitoredItem[],
    index: number,
    subscriptionRequest: subscriptionContext
): number {
    for (let i = 0; i < MAX_SUBSCRIPTIONS; i++) {
        if (activeSubscriptions[i].subscriptionID === subscriptionRequest.subscriptionID) {
            if (typeof removeMonitoredItem === "function") {
                removeMonitoredItem(itemArray, index, subscriptionRequest.subscriptionID);
            }
            return 1;
        }

    }
    return ERROR_NO_AVAILABLE_SUBSCRIPTION;
}

export function removeMonitoredItemsAPI(
    removeMonitoredItems: () => void,
    itemArray: IMonitoredItem[],
    subscriptionRequest: subscriptionContext
): number {
    for (let i = 0; i < MAX_SUBSCRIPTIONS; i++) {
        if (activeSubscriptions[i].subscriptionID === subscriptionRequest.subscriptionID) {
            if (typeof removeMonitoredItems === "function") {
                removeMonitoredItems(itemArray, subscriptionRequest.subscriptionID);
            }
            return activeSubscriptions[i].subscriptionID;
        }

    }
    return ERROR_NO_AVAILABLE_SUBSCRIPTION;
}

export function deleteSubscriptionAPI(
    deleteSubscription: () => void,
    subscriptionRequest: subscriptionContext
): number {
    for (let i = 0; i < MAX_SUBSCRIPTIONS; i++) {
        if (activeSubscriptions[i].subscriptionID === subscriptionRequest.subscriptionID) {
            if (typeof deleteSubscription === "function") {
                deleteSubscription(subscriptionRequest.subscriptionID);

                activeSubscriptions[i].subscriptionID = INVALID_SUBSCRIPTION_ID;
            }
            return 1;
        }
    }
    return ERROR_NO_AVAILABLE_SUBSCRIPTION;
}

export function enablePublishingAPI(
    setIsSubscriptionEnabled: (enabled: boolean, subscriptionID: number) => void,
    value: boolean): number {
    for (let i = 0; i < MAX_SUBSCRIPTIONS; i++) {
        if (activeSubscriptions[i].subscriptionID != INVALID_SUBSCRIPTION_ID) {
            setIsSubscriptionEnabled(value, activeSubscriptions[i].subscriptionID);
        }
    }
    return 1;
}

// TypeScript version of CreateSubscription

export const SubscriptionAPI = () => {
    const { createSubscription } = React.useContext(SubscriptionContext);

    const myPublishCB: publishCB = (...args: any[]) => {
        console.log('Publish callback executed', args);
    };
    const myPublishCtx: LPVOID = {};
    const mySubscriptionID: subscriptionIDType = 0;

    const id = createSubscriptionAPI(createSubscription, myPublishCB, myPublishCtx, mySubscriptionID);

    return 0;
}

export default SubscriptionAPI;
