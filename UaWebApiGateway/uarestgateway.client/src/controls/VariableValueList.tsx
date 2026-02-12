import React from 'react';

import TableContainer from '@mui/material/TableContainer/TableContainer';
import Table from '@mui/material/Table/Table';
import TableHead from '@mui/material/TableHead/TableHead';
import TableRow from '@mui/material/TableRow/TableRow';
import TableCell from '@mui/material/TableCell/TableCell';
import TableBody from '@mui/material/TableBody/TableBody';
import Paper from '@mui/material/Paper/Paper';
import { Typography } from '@mui/material';

import * as OpcUa from 'opcua-webapi';

import DataValueDisplay from './DataValueDisplay';
import { IMonitoredItem } from '../SubscriptionProvider';
import { SubscriptionContext } from '../SubscriptionContext';
import { HandleFactory } from '../service/HandleFactory';
import { SubscriptionState } from '../service/SubscriptionState';
import { IReadValueId } from '../service/IReadValueId';

import { BrowseContext } from '../BrowseContext';

import { createSubscriptionAPI, addMonitoredItemAPI, deleteSubscriptionAPI, removeMonitoredItemsAPI, removeMonitoredItemAPI } from '../SubscriptionAPI';

/**
 * A component that displays a list of variable values.
 * It subscribes to the variables and updates the values when they change.
 */
interface VariableValueListInternals {
   internalHandle: number,
   monitoredItems: IMonitoredItem[],
   requests: number[],
   mounted: boolean,
   cleanedUp: boolean,
    subscriptionId: number | undefined
}

interface VariableValueListProps {
    rootId?: string
    items?: AccessViewItem[];
    accessViewItems?: { displayName: string, nodeId: string, value?: OpcUa.DataValue }[];
}

interface Row {
   name: string,
   item: IMonitoredItem
   monitorID?: number
}

export interface AccessViewItem {
    displayName: string;
    nodeId: string;
    value?: OpcUa.DataValue;
}

export const mySubscriptionContext = {
    subscriptionID: -1,
    publishCB: null,
    publishCtx: {} // or your context value
};



/**
 * 
 * A component that displays a list of variable values.
 * It subscribes to the variables and updates the values when they change.
 * 
 * @param rootId - The root node id to browse.
 * @param accessViewItems - The list of access view items to display.
 * @param items - The list of items to display.
 * @param setItems - The function to set the items.
 * @param setVariables - The function to set the variables.
 * @param counter - The counter to trigger re-rendering.
 * @param setCounter - The function to set the counter.
 * @param m - The reference to the internal state of the component.
 */
export const VariableValueList = ({ rootId, accessViewItems = [] }: VariableValueListProps) => {
   const [items, setItems] = React.useState<AccessViewItem[]>(accessViewItems);
   const [variables, setVariables] = React.useState<Row[]>([]);
   const [counter, setCounter] = React.useState<number>(1);

   const previousLength = React.useRef(variables.length);

    // The reference to the internal state of the component.
    const m = React.useRef<VariableValueListInternals>({
        internalHandle: HandleFactory.increment() + 20000,
        monitoredItems: [],
        requests: [],
        mounted: true,
        cleanedUp: false,
        subscriptionId: undefined
    });

    const monitoredItemId = React.useRef(1);

    /**
     * The effect to clean up the component when it is unmounted.
     * It unsubscribes from the variables and clears the internal state.
     */
    React.useEffect(() => {
        const state = m.current;
        return () => {
            state.mounted = false;
            state.cleanedUp = false;
        };
    }, []);

   // The hook to access active subscription.
   const {
      subscriptionState,
      addNewMonitoredItem,
      removeMonitoredItems,
      removeMonitoredItem,
      deleteSubscription,
      createSubscription,
      subscriptionId,
      //setIsSubscriptionEnabled
    } = React.useContext(SubscriptionContext);

    const {
        browseChildren,
        readValues,
        responseCount,
        processResults
    } = React.useContext(BrowseContext);

    const handlePublish = (
        data: any,
        monitoredItems: Map<number, IMonitoredItem>) => {
        
        data.NotificationMessage?.NotificationData.forEach((eo) => {
            if (eo.UaTypeId === OpcUa.DataTypeIds.DataChangeNotification) {
                const dcn = eo as OpcUa.DataChangeNotification;
                dcn.MonitoredItems?.forEach((ii) => {
                    const item = monitoredItems.get(ii.ClientHandle ?? 0);
                    if (item) {
                        console.log(ii.Value);
                        item.value = ii.Value;
                    }
                });
            }
        });
        setVariables(variables => [...variables]);
    };

    /**
     * The effect to subscribe to the variables when the component is mounted.
     * It creates monitored items for each variable and subscribes to them.
     * 
     * @param accessViewItems - The list of access view items to subscribe to.
     */
    React.useEffect(() => {

        const items: IMonitoredItem[] = [];
        const newVariables: Row[] = [];

        accessViewItems.forEach((x) => {
            items.push({
                nodeId: x.nodeId,
                subscriberHandle: HandleFactory.increment(),
            });
            if (x?.displayName) {
                newVariables.push({ name: x?.displayName, item: items[items.length - 1] });
            }
        });
        
        setVariables(newVariables);

        if (items.length > 0)
            m.current.monitoredItems.push(items[items.length - 1]);

        if (newVariables.length == 1 && mySubscriptionContext.subscriptionID == -1 ) {
            if (typeof createSubscriptionAPI === "function") {

                mySubscriptionContext.publishCB = handlePublish;
                mySubscriptionContext.publishCtx = newVariables; // or your context value
                const result = createSubscriptionAPI(createSubscription, mySubscriptionContext);

                if (result !== -2) {
                    console.log('Subscription created with ID:', result);
                } else {
                    console.error('Failed to create subscription: No available subscription slots.');
                }   
                didRequestSubscription.current = true;
            }
        }
        if (m.current.monitoredItems.length > 1) {
            if (typeof m.current.subscriptionId === 'number') {
                const lastItem = m.current.monitoredItems[m.current.monitoredItems.length - 1];
                const singleItemArray = lastItem ? [lastItem] : [];

                addMonitoredItemAPI(addNewMonitoredItem, singleItemArray, mySubscriptionContext);
                mySubscriptionContext.publishCtx = variables;
                m.current.monitoredItems[m.current.monitoredItems.length - 1].monitoredItemId = monitoredItemId.current;
                monitoredItemId.current++;
            }
        }
        
    }, [accessViewItems]);


    // Effect to add monitored items only after subscription is open
    React.useEffect(() => {
        if (subscriptionState === SubscriptionState.Open && m.current.monitoredItems.length > 0) {
            if (typeof m.current.subscriptionId === 'number') {
                addMonitoredItemAPI(addNewMonitoredItem, m.current.monitoredItems, mySubscriptionContext);
            }
        }
    }, [subscriptionState, addNewMonitoredItem]);
    

    /**
     * Deletes an item from the list and unsubscribes it.
     * @param index - The index of the item to delete.
     */
    const onDeleteItem = (index: number) => {
        removeMonitoredItemAPI(removeMonitoredItem, m.current.monitoredItems, index, mySubscriptionContext);
        accessViewItems.splice(index, 1);
        variables.splice(index, 1);
        setVariables(variables);
        setItems(accessViewItems);
        m.current.monitoredItems.splice(index, 1);

        if (variables.length == 0) {
            //setIsSubscriptionEnabled(false);
            if (typeof subscriptionId === "number" && typeof deleteSubscription === "function") {
                deleteSubscriptionAPI(deleteSubscription, mySubscriptionContext);
                mySubscriptionContext.subscriptionID = -1;
                monitoredItemId.current = 1;
                didRequestSubscription.current = false;
            }
        }
    };

    /**
     * Effect to unsubscribe when the component is unmounted.
     */
    React.useEffect(() => {
        const state = m.current;
        return () => {
            if (!state.mounted && !state.cleanedUp && state.monitoredItems.length) {
                removeMonitoredItemsAPI(removeMonitoredItems, state.monitoredItems, mySubscriptionContext);
                state.cleanedUp = true;
            }
        };
    }, [removeMonitoredItems]);

    /**
     * Effect to read values when the state changes.
     * It creates a list of nodes to read and calls the readValues function.
     */
    React.useEffect(() => {
        if (readValues && variables.length) {
            const nodesToRead: IReadValueId[] = [];
            variables.forEach((x) => {
                if (x.item.nodeId) {
                    nodesToRead.push({
                        id: x.item.subscriberHandle ?? 0,
                        nodeId: x.item.nodeId,
                        path: x.item.path,
                        attributeId: x.item.attributeId
                    });
                }
            });
            m.current.internalHandle = HandleFactory.increment();
            m.current.requests.push(m.current.internalHandle);
            console.error("readValues[" + nodesToRead.length + "]: " + m.current.internalHandle);
            readValues(m.current.internalHandle, nodesToRead);
        }
    }, [readValues, variables]);

    /**
     * Effect to handle the last completed request.
     * It updates the variables and subscribes to them if needed.
     */
    React.useEffect(() => {
        const results = processResults((result) => {
            return m.current.requests.find(x => x === result.callerHandle) ? true : false;
        });
        if (results) {
            results?.forEach(result => {
                m.current.requests = m.current.requests.filter(x => x !== result.callerHandle);
               if (result.values) {
                    result.values.forEach((x) => {
                        const mi = variables.find(y => y.item.subscriberHandle === x.id)
                        if (mi) {
                            mi.item.value = x.value;
                        }
                    });
                    // trigger render after updating the values.
                    setCounter(counter => counter + 1);
                }
            });
        }
    }, [responseCount, processResults, variables, subscriptionState]);

    const didRequestSubscription = React.useRef(false);

    /**
     * Effect when a new subscription ID is received.
     * If the didRequestSubscription flag is true, it means that a the OPC UA part requested a subscription and
     * the monitored items can be set.
     */
    React.useEffect(() => {
        if (didRequestSubscription.current && subscriptionId) {
            m.current.subscriptionId = subscriptionId;
            mySubscriptionContext.subscriptionID = subscriptionId;
            addMonitoredItemAPI(addNewMonitoredItem, m.current.monitoredItems, mySubscriptionContext);
            m.current.monitoredItems[0].monitoredItemId = monitoredItemId.current;
            monitoredItemId.current++;
            didRequestSubscription.current = false; // Reset the flag
        }
    }, [subscriptionId]);

    // Effect to detect when a new element is added to the variables array
    React.useEffect(() => {
        // Read values for new variables
        if (readValues && variables.length) {
            const nodesToRead: IReadValueId[] = [];
            variables.forEach((x) => {
                if (x.item.nodeId) {
                    nodesToRead.push({
                        id: x.item.subscriberHandle ?? 0,
                        nodeId: x.item.nodeId,
                        path: x.item.path,
                        attributeId: x.item.attributeId
                    });
                }
            });
            m.current.internalHandle = HandleFactory.increment();
            m.current.requests.push(m.current.internalHandle);
            console.error("readValues[" + nodesToRead.length + "]: " + m.current.internalHandle);
            readValues(m.current.internalHandle, nodesToRead);
        }
      
        // Perform any additional logic here
        previousLength.current = variables.length;
    }, [variables, createSubscription]);
    

    return (
        <TableContainer component={Paper} elevation={3} sx={{ height: '100%', width: '100%' }}>
            <Table>
                <TableHead>
                    <TableRow>
                        <TableCell><Typography variant='h6'>Name</Typography></TableCell>
                        <TableCell sx={{ width: '100%' }}><Typography variant='h6'>Value</Typography></TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {variables?.map((variable, index) => {
                        if (!variable) return null;
                        return (
                            <TableRow
                                key={variable.name}
                                sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                                onClick={() => onDeleteItem(index)}
                            >
                                <TableCell sx={{ width: 'auto' }}>
                                    <Typography variant='body1' sx={{ minWidth: '300px' }}>{variable.name}</Typography>
                                </TableCell>
                                <TableCell>
                                    <DataValueDisplay value={variable.item.value} />
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </TableContainer>
    );
}

export default VariableValueList;
