import * as React from 'react';
import * as OpcUa from 'opcua-webapi';
import { SessionContext } from './SessionContext';
import { SubscriptionState } from './service/SubscriptionState';
import { HandleFactory } from './service/HandleFactory';
import { SessionState } from './service/SessionState';
import { IRequestMessage } from './service/IRequestMessage';
import { SubscriptionContext } from './SubscriptionContext';
import { handlePublishCallbackAPI } from './SubscriptionAPI';

export interface IMonitoredItem {
   nodeId: string,
   path?: string[],
   resolvedNodeId?: string
   attributeId?: number,
   samplingInterval?: number,
   subscriberHandle?: number,
   itemHandle?: number,
   monitoredItemId?: number,
   value?: OpcUa.DataValue,
   creationError?: OpcUa.StatusCode,
}

export interface ISubscriptionContext {
   publishingInterval?: number,
   setPublishingInterval: (interval: number) => void,
   samplingInterval?: number,
   setSamplingInterval: (interval: number) => void,
   isSubscriptionEnabled: boolean,
   setIsSubscriptionEnabled: (enabled: boolean, subscriptionID: number) => void,
   subscriptionState: SubscriptionState,
   lastSequenceNumber: number,
   addNewMonitoredItem: (items: IMonitoredItem[], clientHandle: number, subsctiptionId: number) => void,
   removeMonitoredItems: (items: IMonitoredItem[], clientHandle: number) => void,
   removeMonitoredItem: (items: IMonitoredItem[], index: number, clientHandle: number) => void,
   createSubscription?: () => void,
   deleteSubscription?: (subscriptionId: number) => void,
   subscriptionId?: number,
   subscribe: (items: IMonitoredItem[], clientHandle: number, subsctiptionId: number) => void,
   unsubscribe: (items: IMonitoredItem[], clientHandle: number) => void
}

interface SubscriptionProps {
   children?: React.ReactNode
}

interface InternalRequest {
    internalHandle?: number,
    serviceId?: string,
    items: IMonitoredItem[]
}

interface SubscriptionInternals {
   isEnabled: boolean,
   publishingInterval: number,
   samplingInterval: number,
   subscriptionState: SubscriptionState,
   subscriptionId?: number,
   monitoredItems: Map<number, IMonitoredItem>
   acknowledgements: OpcUa.SubscriptionAcknowledgement[]
   lastPublishTime?: Date,
   requests: Map<number, InternalRequest>
}

export const SubscriptionProvider = ({ children }: SubscriptionProps) => {
   const [isSubscriptionEnabled, setIsSubscriptionEnabled] = React.useState<boolean>(false);
   const [publishingInterval, setPublishingInterval] = React.useState<number>(1000);
   const [samplingInterval, setSamplingInterval] = React.useState<number>(1000);
   const [subscriptionState, setSubscriptionState] = React.useState<SubscriptionState>(SubscriptionState.Closed);
   const [lastSequenceNumber, setLastSequenceNumber] = React.useState<number>(0);
   const [publishCount, setPublishCount] = React.useState<number>(0);
   const [subscriptionId, setSubscriptionId] = React.useState<number | undefined>(undefined); 

   const {
      sessionState,
      sendRequest,
      messageCounter,
      processMessages
   } = React.useContext(SessionContext);

   const m = React.useRef<SubscriptionInternals>({
      isEnabled: false,
      publishingInterval: 5000,
      samplingInterval: 1000,
      subscriptionState: SubscriptionState.Closed,
      monitoredItems: new Map<number, IMonitoredItem>(),
      acknowledgements: [],
      requests: new Map<number, InternalRequest>(),
      subscriptionId: undefined
   });

    const send = React.useCallback((message: IRequestMessage, request?: InternalRequest) => {
        const internalHandle = request?.internalHandle ?? HandleFactory.increment();
        if (!request) {
            request = {
                internalHandle: internalHandle,
                serviceId: message.ServiceId,
                items: []
            }
        }
        else {
            request.internalHandle = internalHandle;
            request.serviceId = message.ServiceId;
        }
        m.current.requests.set(internalHandle, request);
        sendRequest(message, internalHandle);
    }, [sendRequest]);

    const enablePublishing = React.useCallback((value: boolean, subscriptionId: number) => {
        const request: OpcUa.SetPublishingModeRequest = {
            PublishingEnabled: value,
        }

        request.SubscriptionIds = [];
        if (subscriptionId) {
            request.SubscriptionIds.push(subscriptionId);
        }

        const message: IRequestMessage = {
            ServiceId: OpcUa.DataTypeIds.SetPublishingModeRequest,
            Body: request
        };

        console.warn("enablePublishing");
        send(message);
    }, [send]);

    const createSubscription = React.useCallback(() => {
        const request: OpcUa.CreateSubscriptionRequest = {
            RequestedPublishingInterval: publishingInterval,
            RequestedLifetimeCount: 180,
            RequestedMaxKeepAliveCount: 3,
            MaxNotificationsPerPublish: 1000,
            PublishingEnabled: false,
            Priority: 100
        }
        const message: IRequestMessage = {
            ServiceId: OpcUa.DataTypeIds.CreateSubscriptionRequest,
            Body: request
        };
        send(message);
    }, [send, publishingInterval]);

    const deleteSubscription = React.useCallback((subscriptionId: number) => {
        const request: OpcUa.DeleteSubscriptionsRequest = {
            SubscriptionIds: [subscriptionId]
        }
        const message: IRequestMessage = {
            ServiceId: OpcUa.DataTypeIds.DeleteSubscriptionsRequest,
            Body: request
        };
        send(message);
    }, [send]);

    const publish = React.useCallback(() => {
        const request: OpcUa.PublishRequest = {
            SubscriptionAcknowledgements: m.current.acknowledgements,
        }
        const message: IRequestMessage = {
            ServiceId: OpcUa.DataTypeIds.PublishRequest,
            Body: request
        };
        send(message);
    }, [send]);

    const translate = React.useCallback((items: IMonitoredItem[]) => {
        const browsePaths: OpcUa.BrowsePath[] = [];
        const itemsToTranslate: IMonitoredItem[] = [];
        items.forEach((item) => {
            if (item.resolvedNodeId || item.creationError) {
                return;
            }
            if (!item.path?.length) {
                item.resolvedNodeId = item.nodeId;
                return;
            }
            browsePaths.push({
                StartingNode: item.nodeId,
                RelativePath: {
                    Elements: item.path?.map((path) => {
                        return {
                            ReferenceTypeId: OpcUa.ReferenceTypeIds.HierarchicalReferences,
                            IsInverse: false,
                            IncludeSubtypes: true,
                            TargetName: path
                        } as OpcUa.ReferenceDescription
                    })
                }
            });
            itemsToTranslate.push(item);
        });
        if (itemsToTranslate.length) {
            const request: OpcUa.TranslateBrowsePathsToNodeIdsRequest = {
                BrowsePaths: browsePaths
            }
            const message: IRequestMessage = {
                ServiceId: OpcUa.DataTypeIds.TranslateBrowsePathsToNodeIdsRequest,
                Body: request
            };
            send(message, { items: itemsToTranslate });
        }
    }, [send]);

    const createMonitoredItems = React.useCallback((items: IMonitoredItem[], subsctiptionId: number) => {
        const createRequests: OpcUa.MonitoredItemCreateRequest[] = [];
        const itemsToMonitor: IMonitoredItem[] = [];
        items.forEach((item) => {
            if (item.resolvedNodeId && !item.monitoredItemId && !item.creationError) {
                createRequests.push({
                    ItemToMonitor: {
                        NodeId: item.resolvedNodeId,
                        AttributeId: item.attributeId
                    },
                    MonitoringMode: OpcUa.MonitoringMode.Reporting,
                    RequestedParameters: {
                        ClientHandle: item.itemHandle,
                        SamplingInterval: item.samplingInterval ?? m.current.samplingInterval,
                        QueueSize: 1,
                        DiscardOldest: true
                    }
                });
                itemsToMonitor.push(item);
            }
        });
        if (createRequests.length) {
            const request: OpcUa.CreateMonitoredItemsRequest = {
                SubscriptionId: subsctiptionId,
                TimestampsToReturn: OpcUa.TimestampsToReturn.Both,
                ItemsToCreate: createRequests
            }
            const message: IRequestMessage = {
                ServiceId: OpcUa.DataTypeIds.CreateMonitoredItemsRequest,
                Body: request,
            };
            send(message, { items: itemsToMonitor });
        }
    }, [send]);

    const deleteMonitoredItem = React.useCallback((item: IMonitoredItem, subscriptionId: number) => {
        const itemsToDelete: number[] = [];

        if (item.monitoredItemId) {
            itemsToDelete.push(item.monitoredItemId);
            item.monitoredItemId = undefined;
        }

        if (itemsToDelete.length) {
            const request: OpcUa.DeleteMonitoredItemsRequest = {
                SubscriptionId: subscriptionId,
                MonitoredItemIds: itemsToDelete
            }
            const message: IRequestMessage = {
                ServiceId: OpcUa.DataTypeIds.DeleteMonitoredItemsRequest,
                Body: request
            };
            send(message);
        }
    }, [send]);

    const deleteMonitoredItems = React.useCallback((items: IMonitoredItem[], subscriptionId: number) => {
        const itemsToDelete: number[] = [];
        items.forEach((item) => {
            if (item.monitoredItemId) {
                itemsToDelete.push(item.monitoredItemId);
                item.monitoredItemId = undefined;
            }
        });
        if (itemsToDelete.length) {
            const request: OpcUa.DeleteMonitoredItemsRequest = {
                SubscriptionId: subscriptionId,
                MonitoredItemIds: itemsToDelete
            }
            const message: IRequestMessage = {
                ServiceId: OpcUa.DataTypeIds.DeleteMonitoredItemsRequest,
                Body: request
            };
            send(message);
        }
    }, [send]);

    React.useEffect(() => {
        const messages = processMessages((message) => {
            return m.current.requests.has(message.callerHandle)
        });
        messages?.forEach(message => {
            const request = m.current.requests.get(message?.callerHandle);
            if (request) {
                m.current.requests.delete(message?.callerHandle);
                if (message?.response?.ServiceId === OpcUa.DataTypeIds.CreateSubscriptionResponse) {
                    const csrm = message?.response?.Body as OpcUa.CreateSubscriptionResponse;
                    if (csrm?.ResponseHeader && !csrm?.ResponseHeader.ServiceResult) {
                        m.current.subscriptionId = csrm?.SubscriptionId;
                        setSubscriptionId(m.current.subscriptionId);
                        //m.current.subscriptionState = SubscriptionState.Open;
                        //setSubscriptionState(m.current.subscriptionState);
                        //publish();
                    }
                }
                else if (message?.response?.ServiceId === OpcUa.DataTypeIds.SetPublishingModeResponse) {
                    if (m.current.subscriptionState == SubscriptionState.Open) {
                        setPublishCount(count => count + 1);
                    }
                    else {
                        setPublishCount(0);
                        setLastSequenceNumber(0);
                    }
                  
                }
                else if (message?.response?.ServiceId === OpcUa.DataTypeIds.DeleteSubscriptionsResponse) {
                    m.current.subscriptionId = undefined;
                    setSubscriptionId(m.current.subscriptionId);
                    m.current.acknowledgements = [];
                    m.current.subscriptionState = SubscriptionState.Closed;
                    setSubscriptionState(m.current.subscriptionState);
                    setLastSequenceNumber(0);
                }
                else if (message?.response?.ServiceId === OpcUa.DataTypeIds.PublishResponse) {
                    const prm = message.response?.Body as OpcUa.PublishResponse;
                    setLastSequenceNumber(() => {
                        prm.AvailableSequenceNumbers?.forEach((ii) => {
                            m.current.acknowledgements.push({
                                SubscriptionId: m.current.subscriptionId,
                                SequenceNumber: ii
                            });
                        });
                        //callCallback()--> AAS / OPC UA
                        if (prm.NotificationMessage?.NotificationData) {
                            handlePublishCallbackAPI(prm, m.current.monitoredItems);
                        }
                        setPublishCount(count => count + 1);
                        return prm.NotificationMessage?.SequenceNumber ?? 1;
                    });
                }
                else if (message?.request?.ServiceId === OpcUa.DataTypeIds.TranslateBrowsePathsToNodeIdsRequest) {
                    const response = message.response?.Body as OpcUa.TranslateBrowsePathsToNodeIdsResponse;
                    if (response.ResponseHeader?.ServiceResult?.Code) {
                        request?.items?.forEach((item) => {
                            item.creationError = response.ResponseHeader?.ServiceResult;
                        });
                    }
                    else {
                        response?.Results?.forEach((result, index) => {
                            request.items[index].creationError = result?.StatusCode;
                            if (!result?.StatusCode) {
                                request.items[index].resolvedNodeId = result?.Targets?.at(0)?.TargetId;
                            }
                        });
                        createMonitoredItems(request.items, m.current.subscriptionId);
                    }
                }
                else if (message?.request?.ServiceId === OpcUa.DataTypeIds.CreateMonitoredItemsRequest) {
                    const response = message.response?.Body as OpcUa.CreateMonitoredItemsResponse;
                    if (response.ResponseHeader?.ServiceResult?.Code) {
                        request?.items?.forEach((item) => {
                            item.creationError = response.ResponseHeader?.ServiceResult;
                        });
                    }
                    else {
                        response?.Results?.forEach((result, index) => {
                            request.items[index].creationError = result?.StatusCode;
                            if (!result?.StatusCode) {
                                request.items[index].monitoredItemId = result?.MonitoredItemId;
                            }
                        });
                    }
                }
            }
        });
    }, [messageCounter, processMessages, publish, deleteSubscription, createMonitoredItems])

   React.useEffect(() => {
      if (publishCount !== 0) {
         //if (sessionState === SessionState.SessionActive) {
         //if (m.current.isEnabled && m.current.subscriptionState === SubscriptionState.Open) {
         if (m.current.subscriptionState === SubscriptionState.Open) {
               console.warn("Publish " + publishCount);
               publish();
         }
         //}
      }
   }, [publishCount, sessionState, publish]);

   React.useEffect(() => {
      switch (sessionState) {
         case SessionState.SessionActive:
            if (m.current.isEnabled && m.current.subscriptionState === SubscriptionState.Closed) {
               //createSubscription();
            }
            break;
         default:
            //m.current.subscriptionId = undefined;
            m.current.acknowledgements = [];
            //m.current.subscriptionState = SubscriptionState.Closed;
            //setSubscriptionState(m.current.subscriptionState);
            setLastSequenceNumber(0);
            break;
      }
   }, [sessionState, createSubscription]);

    const subscribe = React.useCallback((items: IMonitoredItem[], clientHandle: number, subscriptionId: number) => {
        items.forEach((item) => {
            item.itemHandle = HandleFactory.increment();
            item.subscriberHandle = item.subscriberHandle || item.itemHandle;
            item.attributeId = item.attributeId || OpcUa.Attributes.Value;
            m.current.monitoredItems.set(item.itemHandle, item);
        });
        translate(items);
        createMonitoredItems(items, subscriptionId);
    }, [translate, createMonitoredItems]);

    const unsubscribe = React.useCallback((items: IMonitoredItem[]) => {
        items.forEach((item) => {
            if (item.itemHandle) {
                m.current.monitoredItems.delete(item.itemHandle);
            }
        });
        //TODO
        //deleteMonitoredItems(items);
    }, [deleteMonitoredItems]);
    

    const addNewMonitoredItem = React.useCallback((items: IMonitoredItem[], subsctiptionId: number ) => {
      items.forEach((item) => {
         item.itemHandle = HandleFactory.increment();
         item.subscriberHandle = item.subscriberHandle || item.itemHandle;
         item.attributeId = item.attributeId || OpcUa.Attributes.Value;
         m.current.monitoredItems.set(item.itemHandle, item);
      });
      translate(items);
      createMonitoredItems(items, subsctiptionId);
   }, [translate, createMonitoredItems]);

    const removeMonitoredItem = React.useCallback((items: IMonitoredItem[], index: number, subscriptionId: number) => {
        if (items.length > 0) {
            deleteMonitoredItem(items[index], subscriptionId);
        }    
    }, [deleteMonitoredItem]);

    const removeMonitoredItems = React.useCallback((items: IMonitoredItem[], subscriptionId: number) => {
      items.forEach((item) => {
         if (item.itemHandle) {
            m.current.monitoredItems.delete(item.itemHandle);
         }
      });
      deleteMonitoredItems(items, subscriptionId);
   }, [deleteMonitoredItems]);

    const setIsSubscriptionEnabledImpl = React.useCallback((value: boolean, subscriptionId: number) => {
      console.log("Set subscription enabled: " + value);
        if (!subscriptionId) {
         return;
      }
      else if (m.current.subscriptionState === SubscriptionState.Closed) {
         enablePublishing(value, subscriptionId);
         //console.warn(m.current.monitoredItems);
         m.current.subscriptionState = SubscriptionState.Open;
         setSubscriptionState(SubscriptionState.Open);
         return;
      }
      else if (m.current.subscriptionState === SubscriptionState.Open) {
          enablePublishing(value, subscriptionId);
          m.current.subscriptionState = SubscriptionState.Closed;
          setSubscriptionState(SubscriptionState.Closed);
         return;
      }
        setIsSubscriptionEnabled(value);
    }, [enablePublishing]);

   const setPublishingIntervalImpl = React.useCallback((value: number) => {
      m.current.publishingInterval = value;
      setPublishingInterval(m.current.publishingInterval);
   }, []);

   const setSamplingIntervalImpl = React.useCallback((value: number) => {
      m.current.samplingInterval = value;
      setSamplingInterval(m.current.samplingInterval);
   }, []);
   
   const subscriptionContext = {
      isSubscriptionEnabled,
      setIsSubscriptionEnabled: setIsSubscriptionEnabledImpl,
      publishingInterval,
      setPublishingInterval: setPublishingIntervalImpl,
      samplingInterval,
      setSamplingInterval: setSamplingIntervalImpl,
      subscriptionState,
      lastSequenceNumber,
      addNewMonitoredItem: addNewMonitoredItem,
      removeMonitoredItems: removeMonitoredItems,
      removeMonitoredItem: removeMonitoredItem,
      createSubscription: createSubscription,
      deleteSubscription: deleteSubscription,
      subscriptionId,
      subscribe: subscribe,
      unsubscribe: unsubscribe
   } as ISubscriptionContext;

   return (
      <SubscriptionContext.Provider value={subscriptionContext}>
         {children}
      </SubscriptionContext.Provider>
   );
};

export default SubscriptionProvider;