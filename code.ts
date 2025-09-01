// =================================================================
// ===== CONSTANTES DE ESTILO E VISUALIZAÇÃO (ATUALIZADAS) =====
// =================================================================

const PADDING_FILL: SolidPaint = { type: 'SOLID', color: { r: 1, g: 0.4, b: 0.4 }, opacity: 0.4 };
const GAP_FILL: SolidPaint = { type: 'SOLID', color: { r: 0.48, g: 0.38, b: 1 }, opacity: 0.5 };

// --- NOVAS CORES PARA AS LINHAS ---
const PADDING_LINE_STROKE: SolidPaint = { type: 'SOLID', color: { r: 1, g: 102 / 255, b: 102 / 255 } }; // #FF6666
const GAP_LINE_STROKE: SolidPaint = { type: 'SOLID', color: { r: 122 / 255, g: 97 / 255, b: 1 } }; // #7A61FF

// --- NOVAS CORES PARA O FUNDO DOS RÓTULOS ---
const PADDING_LABEL_BG: SolidPaint = { type: 'SOLID', color: { r: 1, g: 194 / 255, b: 194 / 255 }, opacity: 0.5 }; // #FFC2C2 50%
const GAP_LABEL_BG: SolidPaint = { type: 'SOLID', color: { r: 122 / 255, g: 97 / 255, b: 1 }, opacity: 0.5 }; // #7A61FF 50%

const LABEL_TEXT_FILL: SolidPaint = { type: 'SOLID', color: { r: 45 / 255, g: 45 / 255, b: 45 / 255 } };
const CONTAINER_BG_FILL: SolidPaint = { type: 'SOLID', color: { r: 245 / 255, g: 246 / 255, b: 250 / 255 } };

// --- NOVAS CONSTANTES PARA POSICIONAMENTO ---
const LINE_EXTENSION = 6; // Quanto a linha sobressai
const LABEL_MARGIN = 2; // Distância do rótulo para a linha


// =================================================================
// ===== FUNÇÕES AUXILIARES =====
// =================================================================

async function createVisualReplica(sourceNode: FrameNode): Promise<FrameNode> {
    // 1. Cria um Frame base sem Auto Layout.
    const replica = figma.createFrame();
    replica.name = sourceNode.name + " (Visual Replica)";

    // 2. Aplica as dimensões exatas.
    replica.resize(sourceNode.width, sourceNode.height);

    // 3. Copia as propriedades visuais da "casca".
    replica.fills = JSON.parse(JSON.stringify(sourceNode.fills));
    replica.strokes = JSON.parse(JSON.stringify(sourceNode.strokes));
    replica.strokeWeight = sourceNode.strokeWeight;
    if (sourceNode.cornerRadius !== figma.mixed) {
        replica.cornerRadius = sourceNode.cornerRadius;
    }
    replica.effects = JSON.parse(JSON.stringify(sourceNode.effects));
    replica.opacity = sourceNode.opacity;
    replica.clipsContent = sourceNode.clipsContent;

    // 4. Recria os filhos (especialmente o texto) do zero.
    if (sourceNode.children) {
        for (const child of sourceNode.children) {
            // Tratamento especial e cuidadoso para nós de texto
            if (child.type === 'TEXT') {
                const textChild = child as TextNode;
                const textReplica = figma.createText();

                // Passo CRÍTICO: Carregar a fonte ANTES de definir qualquer outra propriedade de texto.
                try {
                    await figma.loadFontAsync(textChild.fontName as FontName);
                    textReplica.fontName = textChild.fontName;
                } catch (e) {
                    // Se a fonte não puder ser carregada, usa uma fonte padrão.
                    console.log("Fonte não encontrada, usando padrão:", e);
                    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
                }

                // Agora, aplica o resto das propriedades
                textReplica.characters = textChild.characters;
                textReplica.fontSize = textChild.fontSize;
                textReplica.fills = JSON.parse(JSON.stringify(textChild.fills));
                textReplica.textAlignHorizontal = textChild.textAlignHorizontal;
                textReplica.textAlignVertical = textChild.textAlignVertical;
                
                // Posiciona manualmente
                const transform = textChild.relativeTransform;
                textReplica.x = transform[0][2];
                textReplica.y = transform[1][2];
                
                // Redimensiona o quadro de texto para ser idêntico
                textReplica.resize(textChild.width, textChild.height);

                replica.appendChild(textReplica);

            } else {
                // Para qualquer outro tipo de filho, um clone simples ainda é aceitável.
                const childClone = child.clone();
                const transform = child.relativeTransform;
                childClone.x = transform[0][2];
                childClone.y = transform[1][2];
                replica.appendChild(childClone);
            }
        }
    }

    return replica;
}

async function getColorInfo(paint: SolidPaint, styleId: string | typeof figma.mixed): Promise<{ name: string | null; hex: string }> {
    const hex = rgbToHex(paint.color.r, paint.color.g, paint.color.b);
    let name: string | null = null;
    if (paint.boundVariables && paint.boundVariables.color) {
        const variableId = paint.boundVariables.color.id;
        const variable = await figma.variables.getVariableByIdAsync(variableId);
        if (variable) { name = variable.name; }
    }
    else if (styleId && typeof styleId === 'string') {
        const style = await figma.getStyleByIdAsync(styleId);
        if (style) { name = style.name; }
    }
    return { name, hex };
}

async function createLabel(value: number, anchor: { x: number, y: number }, type: 'padding' | 'gap', alignment: 'left' | 'right' | 'top' | 'bottom'): Promise<FrameNode> {
    const text = figma.createText();
    await figma.loadFontAsync(text.fontName as FontName);
    text.characters = String(Math.round(value));
    text.fontSize = 10;
    text.fills = [LABEL_TEXT_FILL];
    text.textAlignHorizontal = 'CENTER';
    text.textAlignVertical = 'CENTER';

    const padding = 2;
    const rect = figma.createRectangle();
    rect.name = "Label Background";
    rect.resize(text.width + padding * 2, text.height + padding * 2);
    rect.cornerRadius = 4;

    rect.fills = [type === 'padding' ? PADDING_LABEL_BG : GAP_LABEL_BG];

    const labelGroup = figma.createFrame();
    labelGroup.name = `[${value}px]`;
    labelGroup.backgrounds = [];
    labelGroup.resize(rect.width, rect.height);
    rect.x = 0;
    rect.y = 0;
    text.x = (rect.width / 2) - (text.width / 2);
    text.y = (rect.height / 2) - (text.height / 2);
    labelGroup.appendChild(rect);
    labelGroup.appendChild(text);

    switch (alignment) {
        case 'left':
            labelGroup.x = anchor.x - labelGroup.width;
            labelGroup.y = anchor.y - (labelGroup.height / 2);
            break;
        case 'right':
            labelGroup.x = anchor.x;
            labelGroup.y = anchor.y - (labelGroup.height / 2);
            break;
        case 'top':
            labelGroup.x = anchor.x - (labelGroup.width / 2);
            labelGroup.y = anchor.y - labelGroup.height;
            break;
        case 'bottom':
            labelGroup.x = anchor.x - (labelGroup.width / 2);
            labelGroup.y = anchor.y;
            break;
    }

    return labelGroup;
}

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

function rgbToHex(r: number, g: number, b: number): string {
    const toHex = (c: number) => ('0' + Math.round(c * 255).toString(16)).slice(-2);
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}


// ===== FUNÇÃO MODIFICADA =====
// Agora aceita ComponentNode ou FrameNode para ser mais reutilizável com camadas aninhadas.
async function createLayoutVisualization(node: ComponentNode | FrameNode): Promise<FrameNode | null> {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });

    // A chamada agora é para a nova função "createVisualReplica" e precisa de "await".
    const componentPiece = node.type === 'COMPONENT' 
        ? node.createInstance() 
        : await createVisualReplica(node);
    
    const HORIZONTAL_MARGIN = 60;
    const VERTICAL_MARGIN = 30;

    const vizWrapperFrame = figma.createFrame();
    vizWrapperFrame.name = `${node.name} - Layout Visualization`;
    vizWrapperFrame.resize(
        componentPiece.width + HORIZONTAL_MARGIN,
        componentPiece.height + VERTICAL_MARGIN
    );
    vizWrapperFrame.clipsContent = false;
    vizWrapperFrame.backgrounds = [];

    componentPiece.x = HORIZONTAL_MARGIN / 2;
    componentPiece.y = VERTICAL_MARGIN / 2;
    vizWrapperFrame.appendChild(componentPiece);

    const vizElements: (RectangleNode | LineNode | FrameNode)[] = [];

    const createBoundaryLines = (block: RectangleNode, orientation: 'horizontal' | 'vertical', stroke: SolidPaint) => {
        const lines: LineNode[] = [];
        const line1 = figma.createLine();
        const line2 = figma.createLine();
        line1.strokes = [stroke];
        line2.strokes = [stroke];
        line1.strokeWeight = 1;
        line2.strokeWeight = 1;

        if (orientation === 'horizontal') {
            line1.resize(block.width + LINE_EXTENSION, 0);
            line2.resize(block.width + LINE_EXTENSION, 0);
            line1.x = block.x - LINE_EXTENSION;
            line2.x = block.x - LINE_EXTENSION;
            line1.y = block.y;
            line2.y = block.y + block.height;
        } else {
            line1.resize(block.height + LINE_EXTENSION, 0);
            line2.resize(block.height + LINE_EXTENSION, 0);
            line1.rotation = -90;
            line2.rotation = -90;
            line1.x = block.x;
            line2.x = block.x + block.width;
            line1.y = block.y - LINE_EXTENSION;
            line2.y = block.y - LINE_EXTENSION;
        }
        lines.push(line1, line2);
        return lines;
    };

    if (componentPiece.paddingTop > 0) {
        const topBlock = figma.createRectangle();
        topBlock.resize(componentPiece.width, componentPiece.paddingTop);
        topBlock.x = componentPiece.x;
        topBlock.y = componentPiece.y;
        topBlock.fills = [PADDING_FILL];
        vizElements.push(topBlock, ...createBoundaryLines(topBlock, 'horizontal', PADDING_LINE_STROKE));
        const labelAnchor = { x: topBlock.x - LINE_EXTENSION - LABEL_MARGIN, y: topBlock.y + topBlock.height / 2 };
        const label = await createLabel(componentPiece.paddingTop, labelAnchor, 'padding', 'left');
        vizElements.push(label);
    }
    if (componentPiece.paddingBottom > 0) {
        const bottomBlock = figma.createRectangle();
        bottomBlock.resize(componentPiece.width, componentPiece.paddingBottom);
        bottomBlock.x = componentPiece.x;
        bottomBlock.y = componentPiece.y + componentPiece.height - componentPiece.paddingBottom;
        bottomBlock.fills = [PADDING_FILL];
        vizElements.push(bottomBlock, ...createBoundaryLines(bottomBlock, 'horizontal', PADDING_LINE_STROKE));
        const labelAnchor = { x: bottomBlock.x - LINE_EXTENSION - LABEL_MARGIN, y: bottomBlock.y + bottomBlock.height / 2 };
        const label = await createLabel(componentPiece.paddingBottom, labelAnchor, 'padding', 'left');
        vizElements.push(label);
    }
    if (componentPiece.paddingLeft > 0) {
        const height = componentPiece.height - componentPiece.paddingTop - componentPiece.paddingBottom;
        const leftBlock = figma.createRectangle();
        leftBlock.resize(componentPiece.paddingLeft, height);
        leftBlock.x = componentPiece.x;
        leftBlock.y = componentPiece.y + componentPiece.paddingTop;
        leftBlock.fills = [PADDING_FILL];
        vizElements.push(leftBlock, ...createBoundaryLines(leftBlock, 'vertical', PADDING_LINE_STROKE));
        const labelAnchor = { x: leftBlock.x + leftBlock.width / 2, y: leftBlock.y - LINE_EXTENSION - LABEL_MARGIN };
        const label = await createLabel(componentPiece.paddingLeft, labelAnchor, 'padding', 'top');
        vizElements.push(label);
    }
    if (componentPiece.paddingRight > 0) {
        const height = componentPiece.height - componentPiece.paddingTop - componentPiece.paddingBottom;
        const rightBlock = figma.createRectangle();
        rightBlock.resize(componentPiece.paddingRight, height);
        rightBlock.x = componentPiece.x + componentPiece.width - componentPiece.paddingRight;
        rightBlock.y = componentPiece.y + componentPiece.paddingTop;
        rightBlock.fills = [PADDING_FILL];
        vizElements.push(rightBlock, ...createBoundaryLines(rightBlock, 'vertical', PADDING_LINE_STROKE));
        const labelAnchor = { x: rightBlock.x + rightBlock.width / 2, y: rightBlock.y - LINE_EXTENSION - LABEL_MARGIN };
        const label = await createLabel(componentPiece.paddingRight, labelAnchor, 'padding', 'top');
        vizElements.push(label);
    }
    
    if ('children' in componentPiece && componentPiece.children.length > 1 && componentPiece.itemSpacing > 0) {
        for (let i = 0; i < componentPiece.children.length - 1; i++) {
            const currentChild = componentPiece.children[i];
            if (!('relativeTransform' in currentChild)) continue;

            const gapBlock = figma.createRectangle();
            gapBlock.fills = [GAP_FILL];
            
            const childRelativeX = currentChild.relativeTransform[0][2];
            const childRelativeY = currentChild.relativeTransform[1][2];

            if (componentPiece.layoutMode === 'HORIZONTAL') {
                const gapHeight = componentPiece.height - componentPiece.paddingTop - componentPiece.paddingBottom;
                gapBlock.resize(componentPiece.itemSpacing, gapHeight);
                gapBlock.x = componentPiece.x + childRelativeX + currentChild.width;
                gapBlock.y = componentPiece.y + componentPiece.paddingTop;
                const labelAnchor = { x: gapBlock.x + gapBlock.width / 2, y: gapBlock.y - LINE_EXTENSION - LABEL_MARGIN };
                const label = await createLabel(componentPiece.itemSpacing, labelAnchor, 'gap', 'top');
                vizElements.push(gapBlock, ...createBoundaryLines(gapBlock, 'vertical', GAP_LINE_STROKE), label);
            } else { // VERTICAL
                const gapWidth = componentPiece.width - componentPiece.paddingLeft - componentPiece.paddingRight;
                gapBlock.resize(gapWidth, componentPiece.itemSpacing);
                gapBlock.x = componentPiece.x + componentPiece.paddingLeft;
                gapBlock.y = componentPiece.y + childRelativeY + currentChild.height;
                const labelAnchor = { x: gapBlock.x - LINE_EXTENSION - LABEL_MARGIN, y: gapBlock.y + gapBlock.height / 2 };
                const label = await createLabel(componentPiece.itemSpacing, labelAnchor, 'gap', 'left');
                vizElements.push(gapBlock, ...createBoundaryLines(gapBlock, 'horizontal', GAP_LINE_STROKE), label);
            }
        }
    }

    if (vizElements.length > 0) {
        vizElements.forEach(el => vizWrapperFrame.appendChild(el));
        return vizWrapperFrame;
    }

    if (node.type !== 'COMPONENT') {
        componentPiece.remove();
    }
    vizWrapperFrame.remove();
    return null;
}

// =================================================================
// ===== FUNÇÕES DE DOCUMENTAÇÃO (com novas adições) =====
// =================================================================

async function createPropertiesFrame(node: ComponentNode | FrameNode): Promise<FrameNode> {
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
        const colorInfo = await getColorInfo(node.fills[0], node.fillStyleId);
        const label = colorInfo.name ? `${colorInfo.name} (${colorInfo.hex})` : colorInfo.hex;
        frame.appendChild(createText(`Background color: ${label}`));
    }
    if ('strokes' in node && Array.isArray(node.strokes) && node.strokes.length > 0 && node.strokes[0].type === 'SOLID') {
        const colorInfo = await getColorInfo(node.strokes[0], node.strokeStyleId);
        const label = colorInfo.name ? `${colorInfo.name} (${colorInfo.hex})` : colorInfo.hex;
        frame.appendChild(createText(`Border color: ${label}`));
        frame.appendChild(createText(`Border weight: ${typeof node.strokeWeight === 'number' ? node.strokeWeight.toFixed(2) : 'Mixed'}`));
    }
    if ('cornerRadius' in node && typeof node.cornerRadius === 'number') {
        frame.appendChild(createText(`Border radius: ${node.cornerRadius.toFixed(2)}`));
    }
    return frame;
}

async function createSpacingFrame(node: ComponentNode | FrameNode): Promise<FrameNode | null> {
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
    const primaryAlignMap: { [key: string]: string } = { 'MIN': 'Left', 'CENTER': 'Center', 'MAX': 'Right', 'SPACE_BETWEEN': 'Space between' };
    const counterAlignMap: { [key: string]: string } = { 'MIN': 'Top', 'CENTER': 'Middle', 'MAX': 'Bottom', 'BASELINE': 'Baseline' };
    const resizeMap: { [key: string]: string } = { 'FIXED': 'Fixed', 'HUG': 'Hug', 'FILL': 'Fill' };
    const direction = node.layoutMode === 'HORIZONTAL' ? 'Horizontal' : 'Vertical';
    frame.appendChild(createText(`Direction: ${direction}`));
    const alignmentText = `${counterAlignMap[node.counterAxisAlignItems]} ${primaryAlignMap[node.primaryAxisAlignItems]}`;
    frame.appendChild(createText(`Alignment: ${alignmentText}`));
    if ('layoutSizingVertical' in node) frame.appendChild(createText(`Vertical resizing: ${resizeMap[node.layoutSizingVertical]}`));
    if ('layoutSizingHorizontal' in node) frame.appendChild(createText(`Horizontal resizing: ${resizeMap[node.layoutSizingHorizontal]}`));
    frame.appendChild(createText(`Item spacing: ${node.itemSpacing}`));
    const { paddingTop, paddingRight, paddingBottom, paddingLeft } = node;
    if (paddingTop === paddingRight && paddingTop === paddingBottom && paddingTop === paddingLeft) {
        frame.appendChild(createText(`Padding: ${paddingTop}`));
    } else {
        frame.appendChild(createText(`Padding T/R/B/L: ${paddingTop}/${paddingRight}/${paddingBottom}/${paddingLeft}`));
    }
    return frame;
}

// ===== NOVA FUNÇÃO =====
// Encontra recursivamente todos os frames com Auto Layout dentro de um nó.
function findNestedFramesWithLayout(node: SceneNode): FrameNode[] {
    let frames: FrameNode[] = [];
    if ('children' in node) {
        for (const child of node.children) {
            if (child.type === 'FRAME' && child.layoutMode !== 'NONE') {
                frames.push(child);
            }
            // Continua a busca nos filhos do filho
            frames = frames.concat(findNestedFramesWithLayout(child));
        }
    }
    return frames;
}

// ===== NOVA FUNÇÃO =====
// Cria o bloco de documentação completo (título, visualização, specs) para um frame aninhado.
async function createNestedFrameDocumentation(nestedFrame: FrameNode): Promise<FrameNode> {
    const docContainer = figma.createFrame();
    docContainer.name = `Docs for ${nestedFrame.name}`;
    docContainer.layoutMode = 'VERTICAL';
    docContainer.primaryAxisSizingMode = 'AUTO';
    docContainer.counterAxisSizingMode = 'AUTO';
    docContainer.itemSpacing = 16;
    docContainer.fills = [];

    await figma.loadFontAsync({ family: "Inter", style: "Bold" });
    const title = figma.createText();
    title.fontName = { family: "Inter", style: "Bold" };
    title.characters = `Layer: ${nestedFrame.name}`;
    title.fontSize = 16;
    docContainer.appendChild(title);

    const contentRow = figma.createFrame();
    contentRow.name = "Nested Content";
    contentRow.layoutMode = 'HORIZONTAL';
    contentRow.primaryAxisSizingMode = 'AUTO';
    contentRow.counterAxisSizingMode = 'AUTO';
    contentRow.itemSpacing = 32;
    contentRow.counterAxisAlignItems = 'MIN';
    contentRow.fills = [];

    // --- INÍCIO DA CORREÇÃO ---
    // Este frame agora é um container normal, SEM AUTO LAYOUT.
    const vizColumn = figma.createFrame();
    vizColumn.name = "Nested Viz Preview";
    vizColumn.backgrounds = []; // Tornando explícito que não tem fundo

    const layoutViz = await createLayoutVisualization(nestedFrame);
    if (layoutViz) {
        // Redimensionamos o container para ter o mesmo tamanho da visualização...
        vizColumn.resize(layoutViz.width, layoutViz.height);
        // ...e posicionamos a visualização na origem (0,0) do container.
        layoutViz.x = 0;
        layoutViz.y = 0;
        vizColumn.appendChild(layoutViz);
    } else {
        // Fallback caso não haja visualização a ser criada
        const replica = await createVisualReplica(nestedFrame);
        vizColumn.resize(replica.width, replica.height);
        vizColumn.appendChild(replica);
    }
    // --- FIM DA CORREÇÃO ---
    
    contentRow.appendChild(vizColumn);
    
    contentRow.appendChild(await createPropertiesFrame(nestedFrame));
    const spacingFrame = await createSpacingFrame(nestedFrame);
    if (spacingFrame) {
        contentRow.appendChild(spacingFrame);
    }
    
    docContainer.appendChild(contentRow);
    return docContainer;
}


// ===== FUNÇÃO MODIFICADA =====
// Agora integra a documentação das camadas aninhadas.
async function createInstancesAndPropertiesSection(componentSet: ComponentSetNode, makeBox: boolean): Promise<FrameNode> {
    const sectionFrame = figma.createFrame();
    sectionFrame.name = "Properties";
    sectionFrame.layoutMode = "VERTICAL";
    sectionFrame.primaryAxisSizingMode = "AUTO";
    sectionFrame.counterAxisSizingMode = "AUTO";
    sectionFrame.itemSpacing = 40;
    sectionFrame.fills = [];

    for (const variant of componentSet.children) {
        if (variant.type === 'COMPONENT') {
            // Container principal para esta variante e seus filhos
            const variantContainer = figma.createFrame();
            variantContainer.name = `Container for ${variant.name}`;
            variantContainer.layoutMode = "VERTICAL";
            variantContainer.primaryAxisSizingMode = "AUTO";
            variantContainer.counterAxisSizingMode = "AUTO";
            variantContainer.itemSpacing = 32; // Espaço entre a variante principal e as aninhadas
            variantContainer.fills = [];

            // Linha para a variante principal (como era antes)
            const mainVariantRow = figma.createFrame();
            mainVariantRow.name = "Specs";
            mainVariantRow.layoutMode = "HORIZONTAL";
            mainVariantRow.primaryAxisSizingMode = "AUTO";
            mainVariantRow.counterAxisSizingMode = "AUTO";
            mainVariantRow.counterAxisAlignItems = "MIN";
            mainVariantRow.itemSpacing = 32;
            mainVariantRow.fills = [];
            
            const instanceColumn = figma.createFrame();
            instanceColumn.name = "Instance Preview";
            instanceColumn.layoutMode = "VERTICAL";
            instanceColumn.primaryAxisSizingMode = "AUTO";
            instanceColumn.counterAxisSizingMode = "AUTO";
            instanceColumn.itemSpacing = 24;
            instanceColumn.fills = [];
            instanceColumn.counterAxisAlignItems = "CENTER";

            const instance = variant.createInstance();
            instanceColumn.appendChild(instance);

            if (makeBox) {
                const layoutViz = await createLayoutVisualization(variant);
                if (layoutViz) {
                    instanceColumn.appendChild(layoutViz);
                }
            }
            
            mainVariantRow.appendChild(instanceColumn);
            mainVariantRow.appendChild(await createPropertiesFrame(variant));
            const spacingFrame = await createSpacingFrame(variant);
            if (spacingFrame) {
                mainVariantRow.appendChild(spacingFrame);
            }
            
            // Adiciona a linha da variante principal ao container
            variantContainer.appendChild(mainVariantRow);
            
            // --- NOVA LÓGICA PARA CAMADAS ANINHADAS ---
            if (makeBox) {
                const nestedFrames = findNestedFramesWithLayout(variant);
                if (nestedFrames.length > 0) {
                    // Adiciona um separador visual
                    const separator = figma.createRectangle();
                    separator.resize(600, 1);
                    separator.fills = [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8 } }];
                    variantContainer.appendChild(separator);

                    for (const nestedFrame of nestedFrames) {
                        const nestedDoc = await createNestedFrameDocumentation(nestedFrame);
                        variantContainer.appendChild(nestedDoc);
                    }
                }
            }

            sectionFrame.appendChild(variantContainer);
        }
    }
    return sectionFrame;
}


async function createDocumentationBox(componentOrSet: ComponentNode | ComponentSetNode, componentName: string, makeBox: boolean): Promise<FrameNode> {
    const boxDS = figma.createFrame();
    boxDS.name = "Box DS";
    boxDS.layoutMode = "HORIZONTAL";
    boxDS.primaryAxisSizingMode = "AUTO";
    boxDS.counterAxisSizingMode = "AUTO";
    boxDS.itemSpacing = 40;
    boxDS.paddingTop = 40;
    boxDS.paddingBottom = 40;
    boxDS.paddingLeft = 40;
    boxDS.paddingRight = 40;
    boxDS.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    boxDS.cornerRadius = 20;

    const leftColumn = figma.createFrame();
    leftColumn.name = "Component Preview";
    leftColumn.layoutMode = "VERTICAL";
    leftColumn.primaryAxisSizingMode = "AUTO";
    leftColumn.counterAxisSizingMode = "AUTO";
    leftColumn.itemSpacing = 40;
    leftColumn.paddingLeft = 24;
    leftColumn.paddingRight = 24;
    leftColumn.paddingTop = 24;
    leftColumn.paddingBottom = 24;
    leftColumn.fills = [CONTAINER_BG_FILL];
    leftColumn.cornerRadius = 16;

    await figma.loadFontAsync({ family: "Inter", style: "Bold" });
    const title = figma.createText();
    title.fontName = { family: "Inter", style: "Bold" };
    title.characters = componentName;
    title.fontSize = 48;
    leftColumn.appendChild(title);
    leftColumn.appendChild(componentOrSet);

    boxDS.appendChild(leftColumn);

    const rightColumn = figma.createFrame();
    rightColumn.name = "Component Specs";
    rightColumn.layoutMode = "VERTICAL";
    rightColumn.primaryAxisSizingMode = "AUTO";
    rightColumn.counterAxisSizingMode = "AUTO";
    rightColumn.itemSpacing = 40;
    rightColumn.paddingLeft = 24;
    rightColumn.paddingRight = 24;
    rightColumn.paddingTop = 24;
    rightColumn.paddingBottom = 24;
    rightColumn.fills = [CONTAINER_BG_FILL];
    rightColumn.cornerRadius = 16;

    if (componentOrSet.type === 'COMPONENT_SET') {
        const instancesSection = await createInstancesAndPropertiesSection(componentOrSet, makeBox);
        rightColumn.appendChild(instancesSection);
    } else { // Para componente único
        const mainSpecsContainer = figma.createFrame();
        mainSpecsContainer.layoutMode = "HORIZONTAL";
        mainSpecsContainer.primaryAxisSizingMode = "AUTO";
        mainSpecsContainer.counterAxisSizingMode = "AUTO";
        mainSpecsContainer.itemSpacing = 32;
        mainSpecsContainer.fills = [];
        
        const instance = componentOrSet.createInstance();
        mainSpecsContainer.appendChild(instance);
        mainSpecsContainer.appendChild(await createPropertiesFrame(componentOrSet));
        const spacingFrame = await createSpacingFrame(componentOrSet);
        if (spacingFrame) {
            mainSpecsContainer.appendChild(spacingFrame);
        }
        rightColumn.appendChild(mainSpecsContainer);

        if (makeBox) {
            const layoutViz = await createLayoutVisualization(componentOrSet);
            if (layoutViz) {
                rightColumn.appendChild(layoutViz);
            }
            // Lógica para camadas aninhadas em um componente único
            const nestedFrames = findNestedFramesWithLayout(componentOrSet);
            if (nestedFrames.length > 0) {
                 const separator = figma.createRectangle();
                 separator.resize(600, 1);
                 separator.fills = [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8 } }];
                 rightColumn.appendChild(separator);
                 for (const nestedFrame of nestedFrames) {
                     const nestedDoc = await createNestedFrameDocumentation(nestedFrame);
                     rightColumn.appendChild(nestedDoc);
                 }
            }
        }
    }
    
    boxDS.appendChild(rightColumn);

    boxDS.x = figma.viewport.center.x - boxDS.width / 2;
    boxDS.y = figma.viewport.center.y - boxDS.height / 2;

    return boxDS;
}


// =================================================================
// ===== LÓGICA PRINCIPAL DO PLUGIN (sem alterações) =====
// =================================================================

figma.showUI(__html__, { width: 340, height: 440 });

function updateSelectionInfo() {
    figma.ui.postMessage({ type: 'selection-info', count: figma.currentPage.selection.length });
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
            await createDocumentationBox(mainComponent, componentName, msg.makeBox);
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
        componentSet.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.001 }];
        if (msg.makeBox) {
            await createDocumentationBox(componentSet, componentName, msg.makeBox);
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