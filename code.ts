// Funções auxiliares existentes (sem alterações)
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

// ----- FUNÇÕES AUXILIARES DA DOCUMENTAÇÃO -----

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (c: number) => ('0' + Math.round(c * 255).toString(16)).slice(-2);
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

async function createPropertiesFrame(node: ComponentNode): Promise<FrameNode> {
    const frame = figma.createFrame();
    frame.name = "Attributes";
    frame.layoutMode = "VERTICAL";
    frame.primaryAxisSizingMode = "AUTO";
    frame.counterAxisSizingMode = "AUTO";
    frame.itemSpacing = 8;
    frame.paddingTop = 16;
    frame.paddingBottom = 16;
    frame.paddingLeft = 16;
    frame.paddingRight = 16;
    frame.fills = [];

    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    await figma.loadFontAsync({ family: "Inter", style: "Bold" });

    const createText = (content: string, isBold = false) => {
        const text = figma.createText();
        text.fontName = { family: "Inter", style: isBold ? "Bold" : "Regular" };
        text.characters = content;
        text.fontSize = 12;
        return text;
    };

    frame.appendChild(createText(node.name, true));
    const heightText = `Height: ${'layoutSizingVertical' in node && node.layoutSizingVertical === 'HUG' ? 'Hug' : `${node.height.toFixed(2)}px or ${(node.height / 16).toFixed(2)}rem`}`;
    const widthText = `Width: ${'layoutSizingHorizontal' in node && node.layoutSizingHorizontal === 'HUG' ? 'Hug' : `${node.width.toFixed(2)}px or ${(node.width / 16).toFixed(2)}rem`}`;
    
    frame.appendChild(createText(heightText));
    frame.appendChild(createText(widthText));

    if ('fills' in node && Array.isArray(node.fills) && node.fills.length > 0 && node.fills[0].type === 'SOLID') {
        const color = node.fills[0].color;
        frame.appendChild(createText(`Background color: ${rgbToHex(color.r, color.g, color.b)}`));
    }
    if ('strokes' in node && Array.isArray(node.strokes) && node.strokes.length > 0 && node.strokes[0].type === 'SOLID') {
        const color = node.strokes[0].color;
        frame.appendChild(createText(`Border color: ${rgbToHex(color.r, color.g, color.b)}`));
        frame.appendChild(createText(`Border weight: ${node.strokeWeight.toFixed(2)}`));
    }
    if ('cornerRadius' in node && typeof node.cornerRadius === 'number') {
        frame.appendChild(createText(`Border radius: ${node.cornerRadius.toFixed(2)}`));
    }
    return frame;
}

// **NOVA FUNÇÃO** para criar o frame de espaçamento (Auto Layout)
async function createSpacingFrame(node: ComponentNode): Promise<FrameNode | null> {
    // Se o nó não usa Auto Layout, não retorna nada
    if (!('layoutMode' in node) || node.layoutMode === 'NONE') {
        return null;
    }

    const frame = figma.createFrame();
    frame.name = "Spacing";
    frame.layoutMode = "VERTICAL";
    frame.primaryAxisSizingMode = "AUTO";
    frame.counterAxisSizingMode = "AUTO";
    frame.itemSpacing = 8;
    frame.paddingTop = 16;
    frame.paddingBottom = 16;
    frame.paddingLeft = 16;
    frame.paddingRight = 16;
    frame.fills = [];

    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    await figma.loadFontAsync({ family: "Inter", style: "Bold" });

    const createText = (content: string, isBold = false) => {
        const text = figma.createText();
        text.fontName = { family: "Inter", style: isBold ? "Bold" : "Regular" };
        text.characters = content;
        text.fontSize = 12;
        return text;
    };

    frame.appendChild(createText("Spacing", true));

    // Mapeamento de valores da API para texto legível
    const primaryAlignMap: { [key: string]: string } = { 'MIN': 'Left', 'CENTER': 'Center', 'MAX': 'Right', 'SPACE_BETWEEN': 'Space between' };
    const counterAlignMap: { [key: string]: string } = { 'MIN': 'Top', 'CENTER': 'Middle', 'MAX': 'Bottom', 'BASELINE': 'Baseline' };
    const resizeMap: { [key: string]: string } = { 'FIXED': 'Fixed', 'HUG': 'Hug', 'FILL': 'Fill' };
    
    // Direction
    const direction = node.layoutMode === 'HORIZONTAL' ? 'Horizontal' : 'Vertical';
    frame.appendChild(createText(`Direction: ${direction}`));

    // Alignment
    const alignmentText = `${counterAlignMap[node.counterAxisAlignItems]} ${primaryAlignMap[node.primaryAxisAlignItems]}`;
    frame.appendChild(createText(`Alignment: ${alignmentText}`));

    // Resizing
    frame.appendChild(createText(`Vertical resizing: ${resizeMap[node.layoutSizingVertical]}`));
    frame.appendChild(createText(`Horizontal resizing: ${resizeMap[node.layoutSizingHorizontal]}`));

    // Item Spacing
    frame.appendChild(createText(`Item spacing: ${node.itemSpacing}`));

    // Padding
    const { paddingTop, paddingRight, paddingBottom, paddingLeft } = node;
    if (paddingTop === paddingRight && paddingTop === paddingBottom && paddingTop === paddingLeft) {
        frame.appendChild(createText(`Padding: ${paddingTop}`));
    } else {
        // Se os paddings forem diferentes, mostra todos
        frame.appendChild(createText(`Padding T/R/B/L: ${paddingTop}/${paddingRight}/${paddingBottom}/${paddingLeft}`));
    }

    return frame;
}

// Função para criar a seção de propriedades com instâncias **ATUALIZADA**
async function createInstancesAndPropertiesSection(componentSet: ComponentSetNode): Promise<FrameNode> {
    const sectionFrame = figma.createFrame();
    sectionFrame.name = "Properties";
    sectionFrame.layoutMode = "VERTICAL";
    sectionFrame.primaryAxisSizingMode = "AUTO";
    sectionFrame.counterAxisSizingMode = "AUTO";
    sectionFrame.itemSpacing = 24;
    sectionFrame.fills = [];

    for (const variant of componentSet.children) {
        if (variant.type === 'COMPONENT') {
            const row = figma.createFrame();
            row.name = `Instance of: ${variant.name}`;
            row.layoutMode = "HORIZONTAL";
            row.primaryAxisSizingMode = "AUTO";
            row.counterAxisSizingMode = "AUTO";
            row.counterAxisAlignItems = "CENTER";
            row.itemSpacing = 32;
            row.fills = [];
            
            // Cria a instância
            const instance = variant.createInstance();
            row.appendChild(instance);
            
            // Adiciona o frame de atributos (já existente)
            row.appendChild(await createPropertiesFrame(variant));
            
            // **NOVO**: Adiciona o frame de espaçamento (se houver Auto Layout)
            const spacingFrame = await createSpacingFrame(variant);
            if (spacingFrame) {
                row.appendChild(spacingFrame);
            }
            
            sectionFrame.appendChild(row);
        }
    }
    return sectionFrame;
}

// Função de documentação (sem alterações)
async function createDocumentationBox(componentOrSet: ComponentNode | ComponentSetNode, componentName: string): Promise<FrameNode> {
    const boxDS = figma.createFrame();
    boxDS.name = "Box DS";
    boxDS.layoutMode = "HORIZONTAL";
    boxDS.primaryAxisSizingMode = "AUTO";
    boxDS.counterAxisSizingMode = "AUTO";
    boxDS.itemSpacing = 64;
    boxDS.paddingTop = 40;
    boxDS.paddingBottom = 40;
    boxDS.paddingLeft = 40;
    boxDS.paddingRight = 40;
    boxDS.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    boxDS.cornerRadius = 20;

    const infoFrame = figma.createFrame();
    infoFrame.name = "Titulo e descrição";
    infoFrame.layoutMode = "VERTICAL";
    infoFrame.primaryAxisSizingMode = "AUTO";
    infoFrame.counterAxisSizingMode = "AUTO";
    infoFrame.minWidth = 440;
    infoFrame.fills = [];

    await figma.loadFontAsync({ family: "Inter", style: "Bold" });
    const title = figma.createText();
    title.fontName = { family: "Inter", style: "Bold" };
    title.characters = componentName;
    title.fontSize = 48;
    infoFrame.appendChild(title);
    
    boxDS.appendChild(infoFrame);

    const rightContainer = figma.createFrame();
    rightContainer.name = "Component Container";
    rightContainer.layoutMode = "VERTICAL";
    rightContainer.primaryAxisSizingMode = "AUTO";
    rightContainer.counterAxisSizingMode = "AUTO";
    rightContainer.itemSpacing = 40;
    rightContainer.fills = [];
    
    rightContainer.appendChild(componentOrSet);

    if (componentOrSet.type === 'COMPONENT_SET') {
        const instancesSection = await createInstancesAndPropertiesSection(componentOrSet);
        rightContainer.appendChild(instancesSection);
    } else {
        rightContainer.appendChild(await createPropertiesFrame(componentOrSet));
        // Adiciona também o spacing frame para o master component
        const spacingFrame = await createSpacingFrame(componentOrSet);
        if (spacingFrame) {
            rightContainer.appendChild(spacingFrame);
        }
    }
    
    boxDS.appendChild(rightContainer);

    boxDS.x = figma.viewport.center.x - boxDS.width / 2;
    boxDS.y = figma.viewport.center.y - boxDS.height / 2;

    return boxDS;
}

// ----- LÓGICA PRINCIPAL DO PLUGIN (sem alterações) -----

figma.showUI(__html__, { width: 340, height: 440 });

function updateSelectionInfo() {
    figma.ui.postMessage({
        type: 'selection-info',
        count: figma.currentPage.selection.length
    });
}
updateSelectionInfo();

figma.on('selectionchange', updateSelectionInfo);

figma.ui.onmessage = async (msg) => {
    if (msg.type === 'cancel') {
        figma.closePlugin();
        return;
    }

    const selection = figma.currentPage.selection;
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
        copyProperties(masterNode, mainComponent);

        if (msg.makeBox) {
            await createDocumentationBox(mainComponent, componentName);
        } else {
            mainComponent.x = figma.viewport.center.x - mainComponent.width / 2;
            mainComponent.y = figma.viewport.center.y - mainComponent.height / 2 + 150;
        }
        
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
        selection.forEach(node => {
            const fingerprint = getNodeFingerprint(node);
            if (!groups.has(fingerprint)) groups.set(fingerprint, []);
            groups.get(fingerprint)!.push(node);
        });
        if (groups.size < 2) {
            figma.notify("⚠️ Você precisa de pelo menos dois tipos de objetos diferentes para criar variantes.", { error: true });
            return;
        }
        const variantComponents: ComponentNode[] = [];
        const nodeToVariantMap = new Map<string, ComponentNode>();
        let variantIndex = 1;
        for (const [, nodes] of groups.entries()) {
            const representativeNode = nodes[0];
            const newComponent = figma.createComponent();
            if ('children' in representativeNode) {
                for (const child of representativeNode.children) newComponent.appendChild(child.clone());
            }
            newComponent.name = msg.useLayerName ? `Type=${representativeNode.name}` : `Variant=${variantIndex++}`;
            copyProperties(representativeNode, newComponent);
            variantComponents.push(newComponent);
            nodes.forEach(node => nodeToVariantMap.set(node.id, newComponent));
        }

        const componentSet = figma.combineAsVariants(variantComponents, figma.currentPage);
        componentSet.name = componentName;
        
        componentSet.layoutMode = "VERTICAL";
        componentSet.itemSpacing = 24;
        componentSet.paddingTop = 24;
        componentSet.paddingRight = 24;
        componentSet.paddingBottom = 24;
        componentSet.paddingLeft = 24;
        componentSet.primaryAxisSizingMode = 'AUTO';
        componentSet.counterAxisSizingMode = 'AUTO';
        componentSet.counterAxisAlignItems = 'CENTER';
        componentSet.fills = [{ type: 'SOLID', color: {r:0, g:0, b:0}, opacity: 0.001 }];

        if (msg.makeBox) {
            await createDocumentationBox(componentSet, componentName);
        } else {
            componentSet.x = figma.viewport.center.x - componentSet.width / 2;
            componentSet.y = figma.viewport.center.y - componentSet.height / 2 + 150;
        }

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
};