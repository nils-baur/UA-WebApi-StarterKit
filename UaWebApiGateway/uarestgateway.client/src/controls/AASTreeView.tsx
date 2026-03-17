import React, { useEffect, useState, useCallback, useContext, useRef } from "react";
import { TreeView } from "@mui/x-tree-view/TreeView";
import { TreeItem } from "@mui/x-tree-view/TreeItem";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import * as aas from "@aas-core-works/aas-core3.0-typescript";
import ContextMenu from "../ContextMenu";
import { SessionContext } from "../SessionContext";
import { sendAASRequest } from "../utils/SendAASRequest";

import { IMonitoredItem } from '../SubscriptionProvider';
import { SubscriptionContext } from '../SubscriptionContext';
import { createSubscriptionAPI, addMonitoredItemAPI, deleteSubscriptionAPI, removeMonitoredItemsAPI, removeMonitoredItemAPI } from '../SubscriptionAPI';

import * as OpcUa from 'opcua-webapi';

interface TreeNode {
    id: string;
    name: string;
    type: string;
    children?: TreeNode[];
    original: aas.types.Class | null;
    parentAASId?: string;
    parentSubmodelId?: string;
    path?: string;
    pollIntervalId?: number;
    value?: any;
    isOpcUa?: boolean;
    nodeId?: string | null;
}

type SubmodelElementInfoDto = {
    submodelElement: any;
    isOpcUa: boolean;
    nodeId: string | null;
};

type mappedIds = {
    nodeId: string;
    itemId: number;
};
export const mySubscriptionContext = {
    subscriptionID: -1,
    publishCB: null,
    publishCtx: {}, // or your context value
    mappedNodeIDs: [] as mappedIds[], // to track nodeIds for monitored items
};


const AASTreeView: React.FC = () => {
    const [treeData, setTreeData] = useState<TreeNode | null>(null);
    const [selected, setSelected] = useState<aas.types.Class | null>(null);
    const [contextMenu, setContextMenu] = useState<{ mouseX: number; mouseY: number; node: TreeNode } | null>(null);
    const [accessViewItems, setAccessViewItems] = useState<TreeNode[]>([]);
    const [accessViewContextMenu, setAccessViewContextMenu] = useState<{ mouseX: number; mouseY: number; index: number } | null>(null);

    const session = useContext(SessionContext);
    const sessionRef = useRef(session);

    const {
        addNewMonitoredItem,
        removeMonitoredItem,
        createSubscription,
        deleteSubscription,
        subscriptionId,
    } = React.useContext(SubscriptionContext);

    const monitoredItemId = React.useRef(1);
    const didRequestSubscription = React.useRef(false);
    const mappedNodeId = React.useRef<string[]>([]);

    const handlePublish = (
        data: any,
        monitoredItems: Map<number, IMonitoredItem>) => {
        console.log("Received publish update:", data, monitoredItems);
        setAccessViewItems(prev => prev.map(item => {
            data.NotificationMessage?.NotificationData.forEach((eo) => {
                if (eo.UaTypeId === OpcUa.DataTypeIds.DataChangeNotification) {
                    const dcn = eo as OpcUa.DataChangeNotification;
                    dcn.MonitoredItems?.forEach((ii) => {
                        const itemValue = ii.Value?.Value;
                        monitoredItems.forEach((mi) => {
                            mySubscriptionContext.mappedNodeIDs.forEach((mappedId) => {
                                if (item.isOpcUa && mappedId.nodeId === mi.nodeId) {
                                    console.log(`Updating item ${item.name} with new value:`, itemValue);
                                    setAccessViewItems(prevItems => prevItems.map(i => i.id === item.id ? { ...i, value: itemValue } : i));
                                    return { ...item, itemValue };
                                }
                            });
                        });
                    });
                }
            });

            return item;
        }));
    };


    useEffect(() => {
        sessionRef.current = session;
    }, [session]);

    useEffect(() => {
        loadTree();
        return () => {
            accessViewItems.forEach(item => {
                if (item.pollIntervalId) clearInterval(item.pollIntervalId);
            });
        };
    }, []);

    useEffect(() => {
        const session = sessionRef.current;
        const listener = (response: IResponseMessage) => {
            const updatedPath = response?.Body?.Path;
            const value = response?.Body?.Result?.value ?? response?.Body?.Result;

            if (!updatedPath) return;

            console.log("Push update for", updatedPath, value);

            setAccessViewItems(prev =>
                prev.map(item =>
                    item.path === updatedPath ? { ...item, value } : item
                )
            );
        };

        if (session.addPushUpdateListener) {
            session.addPushUpdateListener(listener);
        }

        return () => {
            // no built-in removeListener logic, but if you build it later, clean up here
        };
    }, [session, session.messageCounter]);




    const loadTree = async () => {
        const shellJson = await sendAASRequest(sessionRef.current, "GET", "/shells");
        const shell = aas.jsonization.assetAdministrationShellFromJsonable(shellJson).mustValue();

        const children: TreeNode[] = [];
        for (const ref of shell.submodels ?? []) {
            const id = ref.keys[0].value;
            const smJson = await sendAASRequest(sessionRef.current, "GET", `/shells/${encodeId(shell.id)}/submodels/${encodeId(id)}`);
            const sm = aas.jsonization.submodelFromJsonable(smJson).mustValue();
            children.push(await submodelToTree(sm, shell.id));
        }

        setTreeData({ id: shell.id, name: `AAS: ${shell.idShort}`, type: "AssetAdministrationShell", original: shell, children });
    };

    const submodelToTree = async (submodel: aas.types.Submodel, aasId: string): Promise<TreeNode> => {
        const children: TreeNode[] = [];
        for (const el of submodel.submodelElements ?? []) {
            children.push(await elementToTree(el, aasId, submodel.id, el.idShort ?? "", ""));
        }
        return {
            id: submodel.id,
            name: `Submodel: ${submodel.idShort}`,
            type: "Submodel",
            original: submodel,
            parentAASId: aasId,
            parentSubmodelId: submodel.id,
            children,
        };
    };

    const elementToTree = async (element: aas.types.ISubmodelElement, aasId: string, submodelId: string, idShort: string, parentPath: string): Promise<TreeNode> => {
        const label = `${getSubmodelElementAbbreviation(element)}: ${element.idShort}`;
        const currentPath = parentPath ? `${parentPath}.${idShort}` : idShort;
        const children: TreeNode[] = [];

        if (element instanceof aas.types.SubmodelElementCollection && element.value) {
            for (const el of element.value) {
                children.push(await elementToTree(el, aasId, submodelId, el.idShort ?? "", currentPath));
            }
        }

        return {
            id: generateUUIDv4(),
            name: label,
            type: element.constructor.name,
            original: element,
            parentAASId: aasId,
            parentSubmodelId: submodelId,
            path: currentPath,
            children,
        };
    };

    // FIX: Robustly unwrap the scalar value from any response shape.
    //
    // The AAS submodel-element endpoint can return different shapes depending
    // on the transport layer:
    //
    //   REST shape:      { idShort: "PCFCO2eq", modelType: "Property", value: 3.55 }
    //   WebSocket shape: { submodelElement: { idShort: "PCFCO2eq", value: 3.55 }, isOpcUa: true, nodeId: "..." }
    //                    (backend returns the /info DTO shape instead of the bare element)
    //
    // Previously `result?.value ?? result` worked for REST but for WebSocket it
    // picked up the full `submodelElement` object as the value, causing the
    // access view to render the entire serialized object instead of the scalar.
    const fetchValue = async (node: TreeNode) => {
        if (!node.parentAASId || !node.parentSubmodelId || !node.path) {
            console.log("fetchValue RETURN NULL");
            return null;
        }
        try {
            const result = await sendAASRequest(
                sessionRef.current,
                "GET",
                `/shells/${encodeId(node.parentAASId)}/submodels/${encodeId(node.parentSubmodelId)}/submodel-elements/${node.path}`
            );
            console.log("fetchValue result:", result);

            // WebSocket path: backend wraps the element in { submodelElement: { value: X }, ... }
            if (result?.submodelElement !== undefined) {
                const inner = result.submodelElement;
                return inner?.value ?? inner;
            }

            // REST path: bare element { ..., value: X }
            if (result?.value !== undefined) {
                return result.value;
            }

            return result;
        } catch (e) {
            console.error("Polling error:", e);
            return null;
        }
    };

    React.useEffect(() => {
        if (didRequestSubscription.current && subscriptionId) {
            mySubscriptionContext.subscriptionID = subscriptionId;
            const items: IMonitoredItem[] = [];
            items.push({
                nodeId: mySubscriptionContext.mappedNodeIDs[0].nodeId,
            });
            addMonitoredItemAPI(addNewMonitoredItem, items, mySubscriptionContext);
            mySubscriptionContext.mappedNodeIDs[0].itemId = monitoredItemId.current;
            monitoredItemId.current++;
            didRequestSubscription.current = false; // Reset the flag
        }
    }, [subscriptionId]);

    type SubmodelElementInfoDto = {
        submodelElement?: any;
        isOpcUa?: boolean;
        nodeId?: string | null;

        // fallback (PascalCase)
        SubmodelElement?: any;
        IsOpcUa?: boolean;
        NodeId?: string | null;
    };

    const handleOnAddAccessView = useCallback(() => {
        if (!contextMenu?.node) return;

        const node = contextMenu.node;
        const session = sessionRef.current;

        const path = node.path!;
        const url = `/shells/${encodeId(node.parentAASId!)}/submodels/${encodeId(
            node.parentSubmodelId!
        )}/submodel-elements/${path}`;
        const infoUrl = `${url}/info`;

        const fetchAndUpdate = async () => {
            console.log(`fetchAndUpdate node: ${node.name}`);
            const value = await fetchValue(node);
            setAccessViewItems(prev =>
                prev.map(i => (i.id === node.id ? { ...i, value } : i))
            );
            console.log(`fetchAndUpdate value:`, value);
        };

        const updateItem = (patch: Partial<TreeNode>) => {
            setAccessViewItems(prev =>
                prev.map(i => (i.id === node.id ? { ...i, ...patch } : i))
            );
        };

        const run = async () => {
            // If the item already exists in access view, cancel its poll
            const existing = accessViewItems.find(i => i.id === node.id);
            if (existing?.pollIntervalId) {
                clearInterval(existing.pollIntervalId);
                updateItem({ pollIntervalId: undefined });
            }

            // 1) Call infoUrl once to get IsOpcUa + NodeId (+ element)
            let isOpcUa = false;
            let returnedElement: any = null;

            try {
                const info: SubmodelElementInfoDto = await sendAASRequest(session, "GET", infoUrl);

                returnedElement = info.submodelElement ?? info.SubmodelElement ?? null;
                isOpcUa = (info.isOpcUa ?? info.IsOpcUa) ?? false;

                const nodeId = info.nodeId ?? info.NodeId;
                if (typeof nodeId === "string" && nodeId.length > 0) {
                    mySubscriptionContext.mappedNodeIDs.push({ nodeId, itemId: monitoredItemId.current });
                }
                console.log(`[AAS] isOpcUa: ${isOpcUa}, nodeId: ${nodeId}`);

                if (mySubscriptionContext.subscriptionID == -1 && isOpcUa) {
                    if (typeof createSubscription === "function") {
                        mySubscriptionContext.publishCB = handlePublish;
                        const result = createSubscriptionAPI(createSubscription, mySubscriptionContext);

                        if (result !== -2) {
                            console.log('Subscription created with ID:', result);
                        } else {
                            console.error('Failed to create subscription: No available subscription slots.');
                        }
                        didRequestSubscription.current = true;
                    }
                }
                else if (mySubscriptionContext.subscriptionID != -1 && isOpcUa) {
                    const items: IMonitoredItem[] = [];
                    items.push({
                        nodeId: mySubscriptionContext.mappedNodeIDs[mySubscriptionContext.mappedNodeIDs.length - 1].nodeId,
                    });
                    addMonitoredItemAPI(addNewMonitoredItem, items, mySubscriptionContext);
                    mySubscriptionContext.mappedNodeIDs[mySubscriptionContext.mappedNodeIDs.length - 1].itemId = monitoredItemId.current;
                    monitoredItemId.current++;
                }

                // Store info on the access view item.
                // Note: we do NOT set `original` to returnedElement here, because
                // the access view render falls back to `original.value` if `item.value`
                // is not yet set. Setting original to the full info DTO would cause
                // the serialized object to briefly flash before fetchAndUpdate completes.
                if (!existing) {
                    setAccessViewItems(prev => [
                        ...prev,
                        {
                            ...node,
                            isOpcUa,
                            // Keep original as the typed AAS element from the tree,
                            // not the raw DTO, so idShort resolves correctly.
                        }
                    ]);
                } else {
                    updateItem({ isOpcUa });
                }

            } catch (err) {
                console.error("Failed to load info from infoUrl:", err);

                // still ensure item exists
                if (!existing) {
                    setAccessViewItems(prev => [...prev, { ...node }]);
                }
            }

            // 2) Fetch once for initial value display
            await fetchAndUpdate();

            handleCloseContextMenu();
        };

        run();
    }, [contextMenu, accessViewItems]);

    const handleContextMenu = (event: React.MouseEvent, node: TreeNode) => {
        event.preventDefault();
        setContextMenu({ mouseX: event.clientX + 2, mouseY: event.clientY + 2, node });
    };

    const handleCloseContextMenu = () => setContextMenu(null);

    const handleAccessViewContextMenu = (event: React.MouseEvent, index: number) => {
        event.preventDefault();
        setAccessViewContextMenu({ mouseX: event.clientX + 2, mouseY: event.clientY + 2, index });
    };

    const handleRemoveAccessViewItem = (index: number) => {
        const item = accessViewItems[index];
        if (item.isOpcUa) {
            const itemToRemove: IMonitoredItem[] = [];
            mySubscriptionContext.mappedNodeIDs.forEach((mappedId) => {
                itemToRemove.push({
                    nodeId: mappedId.nodeId,
                    monitoredItemId: mappedId.itemId,
                });
            });

            removeMonitoredItemAPI(removeMonitoredItem, itemToRemove, index, mySubscriptionContext);

            mySubscriptionContext.mappedNodeIDs.splice(index, 1); // remove the mapped nodeId at the current iteration index   
        }

        if (typeof createSubscription === "function" && mySubscriptionContext.mappedNodeIDs.length == 0 && mySubscriptionContext.subscriptionID != -1) {
            deleteSubscriptionAPI(deleteSubscription, mySubscriptionContext);
            mySubscriptionContext.subscriptionID = -1;
            monitoredItemId.current = 1;
            didRequestSubscription.current = false;
        }

        setAccessViewItems(prev => {
            const item = prev[index];
            if (item.pollIntervalId) clearInterval(item.pollIntervalId);
            return prev.filter((_, i) => i !== index);
        });
        setAccessViewContextMenu(null);
    };

    // FIX: Prioritise item.value (set by fetchAndUpdate / subscription push) over
    // original.value so that a scalar fetched via WebSocket is shown rather than
    // whatever the tree-node's `original` object carries.
    const renderValue = (val: any): string => {
        if (val == null) return "";
        if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") return val.toString();
        if (Array.isArray(val) && val.every(v => v.language && v.text)) {
            return val.map(v => `[${v.language}]: ${v.text}`).join(", ");
        }
        try {
            return JSON.stringify(val);
        } catch {
            return "[Unsupported Value]";
        }
    };


    const refreshTreeNode = async (node: TreeNode) => {
        if (node.type === "AssetAdministrationShell") {
            await loadTree(); // refresh entire tree
        } else if (node.type === "Submodel") {
            const shellId = node.parentAASId!;
            const submodelId = (node.original && 'id' in node.original) ? (node.original as { id: string }).id : undefined;
            if (!submodelId) return;
            const smJson = await sendAASRequest(sessionRef.current, "GET", `/shells/${encodeId(shellId)}/submodels/${encodeId(submodelId)}`);
            const sm = aas.jsonization.submodelFromJsonable(smJson).mustValue();
            const updatedNode = await submodelToTree(sm, shellId);

            // Replace this submodel in the treeData
            setTreeData(prev => {
                if (!prev) return prev;
                return {
                    ...prev,
                    children: prev.children?.map(child =>
                        child.id === updatedNode.id ? updatedNode : child
                    )
                };
            });
        }
    };

    return (
        <div style={{ display: "flex", height: "80vh", width: "100%" }}>
            <div style={{ width: "33%", overflow: "auto", borderRight: "1px solid #ccc" }}>
                <TreeView defaultCollapseIcon={<ExpandMoreIcon />} defaultExpandIcon={<ChevronRightIcon />}>
                    {treeData && renderTree(treeData)}
                </TreeView>
            </div>
            <div style={{ width: "33%", overflow: "auto", borderRight: "1px solid #ccc", padding: "0 8px" }}>
                {renderDetails()}
            </div>
            <div style={{ width: "34%", overflow: "auto", padding: "0 8px" }}>
                <table style={{ width: "100%", tableLayout: "fixed" }}>
                    <thead><tr><th style={thStyle}>Name (idShort)</th><th style={thStyle}>Value</th></tr></thead>
                    <tbody>
                        {accessViewItems.map((item, idx) => {
                            const original = item.original as aas.types.Class;
                            const idShort = (original as any)?.idShort ?? item.name;

                            // FIX: item.value is set explicitly by fetchAndUpdate and subscription
                            // push updates and always holds the unwrapped scalar. Only fall back
                            // to original.value if item.value has never been set (undefined), NOT
                            // when it is null/0/false (which are valid scalar values).
                            const value = item.value !== undefined
                                ? item.value
                                : (original as any)?.value ?? null;

                            return (
                                <tr key={idx}
                                    onContextMenu={(e) => handleAccessViewContextMenu(e, idx)}
                                    onDoubleClick={(e) => handleAccessViewContextMenu(e, idx)}
                                    style={{ cursor: "context-menu" }}>
                                    <td style={tdStyle}>{idShort}</td>
                                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{renderValue(value)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <ContextMenu anchorPosition={contextMenu ? { mouseX: contextMenu.mouseX, mouseY: contextMenu.mouseY } : null} handleClose={handleCloseContextMenu} onAddAccessView={handleOnAddAccessView} />

            {accessViewContextMenu && (
                <ul style={{
                    position: "fixed",
                    top: accessViewContextMenu.mouseY,
                    left: accessViewContextMenu.mouseX,
                    backgroundColor: "white",
                    border: "1px solid #ccc",
                    boxShadow: "2px 2px 6px rgba(0,0,0,0.2)",
                    listStyle: "none",
                    margin: 0,
                    padding: "4px 0",
                    zIndex: 1000
                }} onMouseLeave={() => setAccessViewContextMenu(null)}>
                    <li style={{ padding: "4px 12px", cursor: "pointer" }}
                        onClick={() => handleRemoveAccessViewItem(accessViewContextMenu.index)}>
                        Remove from Access View
                    </li>
                </ul>
            )}
        </div>
    );

    function renderTree(node: TreeNode): React.ReactNode {
        return (
            <TreeItem key={node.id} nodeId={node.id} label={node.name}
                onClick={async () => {
                    setSelected(node.original);
                    await refreshTreeNode(node);
                }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); handleContextMenu(e, node); }}
                onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); handleContextMenu(e, node); }}>
                {node.children?.map(renderTree)}
            </TreeItem>
        );
    }

    function renderDetails() {
        if (!selected) return <div>Select a node to see details</div>;
        const entries = Object.entries(selected);
        return (
            <table style={{ width: "100%", tableLayout: "fixed" }}>
                <thead><tr><th style={thStyle}>Property</th><th style={thStyle}>Value</th></tr></thead>
                <tbody>
                    {entries.map(([key, value]) => (
                        <tr key={key}><td style={tdStyle}>{key}</td><td style={tdStyle}>{JSON.stringify(value)}</td></tr>
                    ))}
                </tbody>
            </table>
        );
    }
};

const thStyle: React.CSSProperties = {
    textAlign: "left",
    background: "#f0f0f0",
    padding: "8px",
    borderBottom: "1px solid #ccc",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
};

const tdStyle: React.CSSProperties = {
    padding: "8px",
    borderBottom: "1px solid #eee",
    whiteSpace: "nowrap",
    overflow: "auto",
};

function encodeId(id: string): string {
    return btoa(id).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getSubmodelElementAbbreviation(el: aas.types.ISubmodelElement): string {
    const dbg = {
        modelType: (el as any).modelType,
        ctorName: el?.constructor?.name,
        isProperty: aas.types.isProperty(el),
        isMLP: aas.types.isMultiLanguageProperty(el),
        isRange: aas.types.isRange(el),
        isRefEle: aas.types.isReferenceElement(el),
        isRelEle: aas.types.isRelationshipElement(el),
        isARelEle: aas.types.isAnnotatedRelationshipElement(el),
        isFile: aas.types.isFile(el),
        isBlob: aas.types.isBlob(el),
        isSMC: aas.types.isSubmodelElementCollection(el),
        isSML: aas.types.isSubmodelElementList(el),
        isEntity: aas.types.isEntity(el),
        isEvt: aas.types.isBasicEventElement(el),
        isCap: aas.types.isCapability(el),
    };

    if (aas.types.isProperty(el)) return "Prop";
    if (aas.types.isMultiLanguageProperty(el)) return "MLP";
    if (aas.types.isRange(el)) return "Range";
    if (aas.types.isReferenceElement(el)) return "RefEle";
    if (aas.types.isRelationshipElement(el)) return "RelEle";
    if (aas.types.isAnnotatedRelationshipElement(el)) return "ARelEle";
    if (aas.types.isFile(el)) return "File";
    if (aas.types.isBlob(el)) return "Blob";
    if (aas.types.isSubmodelElementCollection(el)) return "SMC";
    if (aas.types.isSubmodelElementList(el)) return "SML";
    if (aas.types.isEntity(el)) return "Ent";
    if (aas.types.isBasicEventElement(el)) return "Evt";
    if (aas.types.isCapability(el)) return "Cap";

    console.warn("[AAS-DEBUG] getSubmodelElementAbbreviation: unknown SME type, returning 'unnamed'", dbg);
    return "unnamed";
}

function generateUUIDv4(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export default AASTreeView;