figma.showUI(__html__, { width: 340, height: 380 });

function getNodeFingerprint(node: SceneNode): string {
    let fingerprint = `type:${node.type};`;
    if ('children' in node) {
        fingerprint += `children:${node.children.length};`;
        node.children.forEach(child => { fingerprint += getNodeFingerprint(child); });
    }
    if ('fills' in node && Array.isArray(node.fills)) fingerprint += `fills:${JSON.stringify(node.fills)};`;
    if ('strokes' in node && Array.isArray(node.strokes)) fingerprint += `strokes:${JSON.stringify(node.strokes)};`;
    if ('width' in node) fingerprint += `size:${node.width.toFixed(2)}x${node.height.toFixed(2)};`;
    return fingerprint;
}

function copyProperties(sourceNode: SceneNode, targetNode: ComponentNode) {

    targetNode.resize(sourceNode.width, sourceNode.height);

    if ('fills' in sourceNode) targetNode.fills = sourceNode.fills;
    if ('strokes' in sourceNode) targetNode.strokes = sourceNode.strokes;
    if ('strokeWeight' in sourceNode) targetNode.strokeWeight = sourceNode.strokeWeight;
    if ('effects' in sourceNode) targetNode.effects = sourceNode.effects;
    if ('cornerRadius' in sourceNode && sourceNode.cornerRadius !== figma.mixed && sourceNode.cornerRadius !== undefined) { targetNode.cornerRadius = sourceNode.cornerRadius; }
    if ('layoutMode' in sourceNode && sourceNode.layoutMode !== 'NONE') {

        targetNode.primaryAxisSizingMode = 'FIXED';
        targetNode.counterAxisSizingMode = 'FIXED';
        targetNode.layoutMode = sourceNode.layoutMode;
        targetNode.primaryAxisAlignItems = sourceNode.primaryAxisAlignItems;
        targetNode.counterAxisAlignItems = sourceNode.counterAxisAlignItems;
        targetNode.itemSpacing = sourceNode.itemSpacing;
        targetNode.paddingTop = sourceNode.paddingTop;
        targetNode.paddingRight = sourceNode.paddingRight;
        targetNode.paddingBottom = sourceNode.paddingBottom;
        targetNode.paddingLeft = sourceNode.paddingLeft;
    }

    if ('constraints' in sourceNode) targetNode.constraints = sourceNode.constraints;
    if ('rotation' in sourceNode) targetNode.rotation = sourceNode.rotation;
    if ('opacity' in sourceNode) targetNode.opacity = sourceNode.opacity;
    if ('blendMode' in sourceNode) targetNode.blendMode = sourceNode.blendMode;
    if ('visible' in sourceNode) targetNode.visible = sourceNode.visible;
    if ('exportSettings' in sourceNode) targetNode.exportSettings = sourceNode.exportSettings;
    if (sourceNode.type === 'TEXT') {
        const targetTextNode = targetNode as unknown as TextNode;
        targetTextNode.textAlignHorizontal = sourceNode.textAlignHorizontal;
        targetTextNode.textAlignVertical = sourceNode.textAlignVertical;
        targetTextNode.textAutoResize = sourceNode.textAutoResize;
        targetTextNode.textCase = sourceNode.textCase;
        targetTextNode.textDecoration = sourceNode.textDecoration;
    }
}

function updateSelectionInfo() {
    figma.ui.postMessage({
        type: 'selection-info',
        count: figma.currentPage.selection.length
    });
}
updateSelectionInfo();

figma.on('selectionchange', updateSelectionInfo);

figma.ui.onmessage = async (msg) => {
    const selection = figma.currentPage.selection;

    if (msg.type === 'cancel') {
        figma.closePlugin();
        return;
    }

    if (msg.type === 'create-master-component' || msg.type === 'create-component-set') {
        if (selection.length < 1) {
            figma.notify("⚠️ Por favor, selecione pelo menos um objeto.", { error: true });
            return;
        }
        
        const componentName = msg.name || selection[0].name;

        if (msg.type === 'create-master-component') {
            const masterNode = selection[0];
            const mainComponent = figma.createComponent();

            if ('children' in masterNode) {
                for (const child of masterNode.children) mainComponent.appendChild(child.clone());
            }

            mainComponent.name = componentName;
            copyProperties(masterNode, mainComponent); // Usa a nova função corrigida
            mainComponent.x = figma.viewport.center.x - mainComponent.width / 2;
            mainComponent.y = figma.viewport.center.y - mainComponent.height / 2 + 150;

            const nodesToReplace = [...selection];
            for (const originalNode of nodesToReplace) {
                if (originalNode.removed) continue;
                const instance = mainComponent.createInstance();
                const parent = originalNode.parent;
                if (parent) {
                    const index = parent.children.indexOf(originalNode);
                    instance.x = originalNode.x;
                    instance.y = originalNode.y;
                    parent.insertChild(index, instance);
                    originalNode.remove();
                }
            }
            figma.notify(`✅ Componente "${mainComponent.name}" criado!`);
        }

        if (msg.type === 'create-component-set') {
            if (selection.length < 2) {
                figma.notify("⚠️ Selecione pelo menos dois objetos para um component set.", { error: true });
                return;
            }

            const groups = new Map<string, SceneNode[]>();
            for (const node of selection) {
                const fingerprint = getNodeFingerprint(node);
                if (!groups.has(fingerprint)) groups.set(fingerprint, []);
                groups.get(fingerprint)!.push(node);
            }

            if (groups.size < 2) {
                figma.notify("⚠️ Você precisa de pelo menos dois tipos de objetos diferentes para criar variantes.", { error: true });
                return;
            }

            const variantComponents: ComponentNode[] = [];
            const nodeToVariantMap = new Map<string, ComponentNode>();
            let variantIndex = 1;

            for (const [fingerprint, nodes] of groups.entries()) {
                const representativeNode = nodes[0];
                const newComponent = figma.createComponent();

                if ('children' in representativeNode) {
                    for (const child of representativeNode.children) newComponent.appendChild(child.clone());
                }
                
                if (msg.useLayerName) {
                    newComponent.name = `Type=${representativeNode.name}`;
                } else {
                    newComponent.name = `Variant=${variantIndex++}`;
                }

                copyProperties(representativeNode, newComponent);
                variantComponents.push(newComponent);
                nodes.forEach(node => nodeToVariantMap.set(node.id, newComponent));
            }

            const componentSet = figma.combineAsVariants(variantComponents, figma.currentPage);
            componentSet.name = componentName;
            
            for (const variant of componentSet.children) {
                if ('layoutSizingHorizontal' in variant) { 
                    variant.layoutSizingHorizontal = 'FIXED';
                    variant.layoutSizingVertical = 'FIXED';
                }
            }
            
            componentSet.x = figma.viewport.center.x - componentSet.width / 2;
            componentSet.y = figma.viewport.center.y - componentSet.height / 2 + 150;
            componentSet.layoutMode = "VERTICAL";
            componentSet.itemSpacing = 24;
            componentSet.paddingTop = 24;
            componentSet.paddingRight = 24;
            componentSet.paddingBottom = 24;
            componentSet.paddingLeft = 24;
            componentSet.primaryAxisSizingMode = 'AUTO';
            componentSet.counterAxisSizingMode = 'AUTO';
            componentSet.counterAxisAlignItems = 'CENTER';

            for (const originalNode of selection) {
                if (originalNode.removed) continue;
                const variantComponent = nodeToVariantMap.get(originalNode.id);
                if (variantComponent) {
                    const instance = variantComponent.createInstance();
                    const parent = originalNode.parent;
                    if (parent) {
                        const index = parent.children.indexOf(originalNode);
                        instance.x = originalNode.x;
                        instance.y = originalNode.y;
                        parent.insertChild(index, instance);
                        originalNode.remove();
                    }
                }
            }
            figma.notify(`✅ Component Set "${componentSet.name}" criado com ${groups.size} variantes!`);
        }
    }
};