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
const CONTAINER_BG_FILL: SolidPaint = { type: 'SOLID', color: { r: 232 / 255, g: 232 / 255, b: 232 / 255 } };

// --- NOVAS CONSTANTES PARA POSICIONAMENTO ---
const LINE_EXTENSION = 6; // Quanto a linha sobressai
const LABEL_MARGIN = 2; // Distância do rótulo para a linha

// Limites para designs complexos (evita travamentos e documentação infinita)
const NESTED_DOC_MAX_DEPTH = 2;
const NESTED_DOC_MAX_COUNT = 12;
const FINGERPRINT_NODE_BUDGET = 4000;

// Ignora filhos invisíveis de instâncias em todas as travessias (performance)
figma.skipInvisibleInstanceChildren = true;


// =================================================================
// ===== INFRAESTRUTURA DE ROBUSTEZ =====
// =================================================================

const FALLBACK_FONT: FontName = { family: "Inter", style: "Regular" };

async function safeLoadFont(font: FontName | typeof figma.mixed): Promise<FontName> {
    if (font !== figma.mixed) {
        try {
            await figma.loadFontAsync(font);
            return font;
        } catch (e) {
            console.warn("Fonte não disponível, usando fallback:", font, e);
        }
    }
    await figma.loadFontAsync(FALLBACK_FONT);
    return FALLBACK_FONT;
}

async function loadAllFontsOf(textNode: TextNode): Promise<void> {
    if (textNode.fontName === figma.mixed) {
        const fonts = textNode.getRangeAllFontNames(0, textNode.characters.length);
        for (const font of fonts) await figma.loadFontAsync(font);
    } else {
        await figma.loadFontAsync(textNode.fontName);
    }
}

/**
 * Executa uma operação de geração garantindo que, em caso de erro, nenhum nó
 * órfão fique para trás no canvas. Todo nó criado pelo plugin nasce como filho
 * da página atual, então basta comparar os filhos da página antes e depois.
 */
async function runSafely(label: string, fn: () => Promise<void>): Promise<void> {
    const before = new Set(figma.currentPage.children.map(node => node.id));
    try {
        await fn();
    } catch (e) {
        for (const child of [...figma.currentPage.children]) {
            if (!before.has(child.id)) {
                try { child.remove(); } catch (_e) { /* já removido com o pai */ }
            }
        }
        const message = e instanceof Error ? e.message : String(e);
        console.error(`Erro ao ${label}:`, e);
        figma.notify(`❌ Erro ao ${label}: ${message}`, { error: true });
    } finally {
        figma.ui.postMessage({ type: 'done' });
    }
}

type SelectionBounds = { x: number; y: number; maxX: number; maxY: number };

function getSelectionBounds(nodes: readonly SceneNode[]): SelectionBounds | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
        const box = node.absoluteBoundingBox;
        if (!box) continue;
        minX = Math.min(minX, box.x);
        minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.width);
        maxY = Math.max(maxY, box.y + box.height);
    }
    return isFinite(minX) ? { x: minX, y: minY, maxX, maxY } : null;
}

/**
 * Posiciona o resultado ao lado direito da seleção original, mantendo o
 * contexto de onde o usuário está trabalhando. Só move a viewport se o
 * resultado ficar fora dela (preserva o zoom do usuário).
 */
function placeNearSelection(node: FrameNode | ComponentNode | ComponentSetNode, bounds: SelectionBounds | null): void {
    if (bounds) {
        node.x = bounds.maxX + 80;
        node.y = bounds.y;
    } else {
        node.x = figma.viewport.center.x - node.width / 2;
        node.y = figma.viewport.center.y - node.height / 2;
    }
    const vb = figma.viewport.bounds;
    const visible = node.x < vb.x + vb.width && node.x + node.width > vb.x &&
        node.y < vb.y + vb.height && node.y + node.height > vb.y;
    if (!visible) {
        figma.viewport.scrollAndZoomIntoView([node]);
    }
}

/**
 * Reaplica nos text nodes da instância o conteúdo dos textos do nó original.
 * Usado quando originais com textos diferentes foram unificados numa variante.
 */
async function applyTextOverrides(instance: InstanceNode, original: SceneNode): Promise<void> {
    const instanceTexts = findTextNodes(instance);
    const originalTexts = findTextNodes(original);
    if (instanceTexts.length !== originalTexts.length) return;
    for (let i = 0; i < instanceTexts.length; i++) {
        if (instanceTexts[i].characters === originalTexts[i].characters) continue;
        try {
            await loadAllFontsOf(instanceTexts[i]);
            instanceTexts[i].characters = originalTexts[i].characters;
        } catch (e) {
            console.warn("Não foi possível aplicar override de texto:", e);
        }
    }
}


// =================================================================
// ===== FUNÇÕES AUXILIARES =====
// =================================================================


async function createDocumentationSection(title: string, content: string): Promise<FrameNode | null> {
    if (!content || content.trim() === '') {
        return null;
    }

    await figma.loadFontAsync({ family: "Inter", style: "Bold" });
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });

    const sectionFrame = figma.createFrame();
    sectionFrame.name = title;
    sectionFrame.layoutMode = 'VERTICAL';
    sectionFrame.primaryAxisSizingMode = 'AUTO'; // HUG na altura
    sectionFrame.counterAxisSizingMode = 'FIXED';  // Largura será controlada pelo PAI
    sectionFrame.itemSpacing = 4;
    sectionFrame.fills = []; // Fundo transparente

    // <<< MUDANÇA IMPORTANTE >>>
    // A largura será definida pelo pai, mas precisamos de um valor inicial
    // para que os filhos possam usar 'STRETCH'. A altura não importa (será HUG).
    sectionFrame.resize(300, 100);

    const titleNode = figma.createText();
    titleNode.fontName = { family: "Inter", style: "Bold" };
    titleNode.characters = title;
    titleNode.fontSize = 12;
    titleNode.layoutAlign = 'STRETCH'; // Ocupa toda a largura

    const contentNode = figma.createText();
    contentNode.fontName = { family: "Inter", style: "Regular" };
    contentNode.characters = content;
    contentNode.fontSize = 12;
    contentNode.textAutoResize = "HEIGHT"; // Essencial para o texto crescer
    contentNode.layoutAlign = 'STRETCH'; // Ocupa toda a largura para quebrar a linha

    sectionFrame.appendChild(titleNode);
    sectionFrame.appendChild(contentNode);
    
    return sectionFrame;
}

function bytesToString(bytes: Uint8Array): string {
    let result = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        result += String.fromCharCode(...Array.from(chunk));
    }
    return result;
}

function minifySVG(svg: string): string {
    return svg
        .replace(/>\s+</g, '><')
        .replace(/\s{2,}/g, ' ')
        .replace(/[\r\n\t]/g, ' ')
        .trim();
}

// Tipos que são inequivocamente desenho vetorial
const STRONG_VECTOR_TYPES = new Set<string>(['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'POLYGON']);
// Formas simples que compõem ícones, mas que sozinhas não bastam (um retângulo é só um retângulo)
const WEAK_VECTOR_TYPES = new Set<string>(['LINE', 'ELLIPSE', 'RECTANGLE']);

function hasAssetNameHint(node: SceneNode): boolean {
    const name = node.name.toLowerCase();
    return name.includes('icon') || name.includes('svg') || name.includes('logo') ||
        name.includes('vector') || name.includes('asset') ||
        /(^|[^a-z])ic[-_]/.test(name);
}

function isVectorLeaf(node: SceneNode): boolean {
    if (STRONG_VECTOR_TYPES.has(node.type)) return true;
    if (WEAK_VECTOR_TYPES.has(node.type)) {
        // Formas com imagem/vídeo de fill não são vetoriais
        const fills = (node as RectangleNode).fills;
        return !Array.isArray(fills) || fills.every(f => f.type !== 'IMAGE' && f.type !== 'VIDEO');
    }
    return false;
}

function collectVisibleLeaves(node: SceneNode, out: SceneNode[] = []): SceneNode[] {
    if (!node.visible) return out;
    if ('children' in node && node.children.length > 0) {
        for (const child of node.children) collectVisibleLeaves(child, out);
    } else {
        out.push(node);
    }
    return out;
}

function isExportableAssetNode(node: SceneNode): boolean {
    if (!node.visible || node.type === 'COMPONENT_SET') return false;

    // Vetores puros são sempre assets
    if (STRONG_VECTOR_TYPES.has(node.type)) return true;

    const nameHint = hasAssetNameHint(node);

    // Containers (frames, grupos, instâncias, componentes) contam como um
    // ícone montado quando todas as folhas visíveis são vetoriais.
    if ('children' in node && node.children.length > 0) {
        const leaves = collectVisibleLeaves(node);
        if (leaves.length === 0) return false;
        const allVector = leaves.every(isVectorLeaf);
        const hasStrongVector = leaves.some(leaf => STRONG_VECTOR_TYPES.has(leaf.type));
        return allVector && (hasStrongVector || nameHint);
    }

    // Formas simples soltas só contam como asset com dica no nome
    return nameHint && WEAK_VECTOR_TYPES.has(node.type);
}

function findExportableAssetNodes(node: SceneNode): SceneNode[] {
    const assets: SceneNode[] = [];
    const seenFingerprints = new Set<string>();

    function walk(currentNode: SceneNode): void {
        if (isExportableAssetNode(currentNode)) {
            // Dedupe assets visualmente idênticos (mesmo ícone repetido)
            const fingerprint = getNodeFingerprint(currentNode);
            if (!seenFingerprints.has(fingerprint)) {
                seenFingerprints.add(fingerprint);
                assets.push(currentNode);
            }
            // Não desce nos filhos de um asset já identificado (evita SVGs duplicados)
            return;
        }
        if ('children' in currentNode) {
            for (const child of currentNode.children) walk(child);
        }
    }

    walk(node);
    return assets;
}

async function createAssetSVGFrame(assetNode: SceneNode): Promise<FrameNode | null> {
    try {
        const svgBytes = await assetNode.exportAsync({
            format: 'SVG',
            svgIdAttribute: false,
            svgOutlineText: true,
            svgSimplifyStroke: false
        });

        const svgString = bytesToString(svgBytes);
        const minifiedSVG = minifySVG(svgString);

        const frame = figma.createFrame();
        frame.name = "Vector";
        frame.layoutMode = "VERTICAL";
        frame.primaryAxisSizingMode = "AUTO";
        frame.counterAxisSizingMode = "AUTO";
        frame.itemSpacing = 8;
        frame.paddingTop = 16;
        frame.paddingBottom = 16;
        frame.paddingLeft = 16;
        frame.paddingRight = 16;
        frame.fills = [];

        await figma.loadFontAsync({ family: "Inter", style: "Bold" });
        await figma.loadFontAsync({ family: "Inter", style: "Regular" });

        const title = figma.createText();
        title.fontName = { family: "Inter", style: "Bold" };
        title.characters = "Vector";
        title.fontSize = 12;
        frame.appendChild(title);

        const svgCodeText = figma.createText();
        svgCodeText.fontName = { family: "Inter", style: "Regular" };
        svgCodeText.characters = minifiedSVG;
        svgCodeText.fontSize = 12;
        
        svgCodeText.textAutoResize = "HEIGHT";
        frame.resize(250, svgCodeText.height);
        frame.counterAxisSizingMode = 'FIXED';
        frame.primaryAxisSizingMode = "AUTO";

        frame.appendChild(svgCodeText);

        return frame;

    } catch (err) {
        console.error("Erro ao exportar SVG do asset:", err);
        // Card de aviso no lugar do asset — falha visível em vez de sumir silenciosamente
        try {
            await figma.loadFontAsync({ family: "Inter", style: "Regular" });
            const errorFrame = figma.createFrame();
            errorFrame.name = `Export failed: ${assetNode.name}`;
            errorFrame.layoutMode = "VERTICAL";
            errorFrame.primaryAxisSizingMode = "AUTO";
            errorFrame.counterAxisSizingMode = "AUTO";
            errorFrame.paddingTop = 8;
            errorFrame.paddingBottom = 8;
            errorFrame.paddingLeft = 8;
            errorFrame.paddingRight = 8;
            errorFrame.fills = [];
            const errorText = figma.createText();
            errorText.fontName = { family: "Inter", style: "Regular" };
            errorText.characters = `⚠️ SVG export failed: ${assetNode.name}`;
            errorText.fontSize = 12;
            errorFrame.appendChild(errorText);
            return errorFrame;
        } catch (_e) {
            return null;
        }
    }
}

async function createAllAssetsSVGFrame(node: SceneNode): Promise<FrameNode | null> {
    // 1. Encontra todos os nós de assets exportáveis dentro do nó principal
    const assetNodes = findExportableAssetNodes(node);

    // 2. Se não encontrar nenhum asset, retorna nulo para não criar um frame vazio
    if (assetNodes.length === 0) {
        return null;
    }

    // 3. Cria um frame "contêiner" para agrupar todos os SVGs encontrados
    const allAssetsContainer = figma.createFrame();
    allAssetsContainer.name = "Assets";
    allAssetsContainer.layoutMode = "VERTICAL";
    allAssetsContainer.primaryAxisSizingMode = "AUTO";
    allAssetsContainer.counterAxisSizingMode = "AUTO";
    allAssetsContainer.itemSpacing = 16;
    allAssetsContainer.fills = []; // Fundo transparente
    allAssetsContainer.paddingTop = 16;
    allAssetsContainer.paddingBottom = 16;
    allAssetsContainer.paddingLeft = 16;
    allAssetsContainer.paddingRight = 16;

    // Adiciona um título geral para a seção de assets
    await figma.loadFontAsync({ family: "Inter", style: "Bold" });
    const title = figma.createText();
    title.fontName = { family: "Inter", style: "Bold" };
    title.characters = "Assets";
    title.fontSize = 12;
    allAssetsContainer.appendChild(title);


    // 4. Itera sobre cada asset encontrado
    for (const assetNode of assetNodes) {
        // 5. Usa a sua função já existente para criar o frame de documentação do SVG
        const singleAssetFrame = await createAssetSVGFrame(assetNode);

        // 6. Adiciona o frame do asset individual ao contêiner principal
        if (singleAssetFrame) {
            // Renomeia para evitar nomes duplicados "Vector"
            singleAssetFrame.name = `Asset: ${assetNode.name}`;
            allAssetsContainer.appendChild(singleAssetFrame);
        }
    }

    // 7. Retorna o contêiner com todos os frames de SVG dentro
    return allAssetsContainer;
}

async function createVisualReplica(sourceNode: FrameNode): Promise<FrameNode> {
    const replica = figma.createFrame();
    replica.name = sourceNode.name + " (Visual Replica)";
    replica.resize(sourceNode.width, sourceNode.height);
    if (Array.isArray(sourceNode.fills)) replica.fills = JSON.parse(JSON.stringify(sourceNode.fills));
    if (Array.isArray(sourceNode.strokes)) replica.strokes = JSON.parse(JSON.stringify(sourceNode.strokes));
    if (sourceNode.strokeWeight !== figma.mixed) replica.strokeWeight = sourceNode.strokeWeight;
    if (sourceNode.cornerRadius !== figma.mixed) {
        replica.cornerRadius = sourceNode.cornerRadius;
    }
    replica.effects = JSON.parse(JSON.stringify(sourceNode.effects));
    replica.opacity = sourceNode.opacity;
    replica.clipsContent = sourceNode.clipsContent;
    
    replica.layoutMode = sourceNode.layoutMode;
    // --- CORREÇÃO ADICIONADA AQUI ---
    // Copia as propriedades de alinhamento que estavam faltando
    replica.primaryAxisAlignItems = sourceNode.primaryAxisAlignItems;
    replica.counterAxisAlignItems = sourceNode.counterAxisAlignItems;
    // --- FIM DA CORREÇÃO ---
    replica.paddingTop = sourceNode.paddingTop;
    replica.paddingBottom = sourceNode.paddingBottom;
    replica.paddingLeft = sourceNode.paddingLeft;
    replica.paddingRight = sourceNode.paddingRight;
    replica.itemSpacing = sourceNode.itemSpacing;

    if (sourceNode.children) {
        for (const child of sourceNode.children) {
            try {
                if (child.type === 'TEXT') {
                    const textChild = child as TextNode;
                    const textReplica = figma.createText();
                    textReplica.fontName = await safeLoadFont(textChild.fontName);
                    textReplica.characters = textChild.characters;
                    if (typeof textChild.fontSize === 'number') textReplica.fontSize = textChild.fontSize;
                    if (Array.isArray(textChild.fills)) textReplica.fills = JSON.parse(JSON.stringify(textChild.fills));
                    textReplica.textAlignHorizontal = textChild.textAlignHorizontal;
                    textReplica.textAlignVertical = textChild.textAlignVertical;
                    const transform = textChild.relativeTransform;
                    textReplica.x = transform[0][2];
                    textReplica.y = transform[1][2];
                    textReplica.resize(textChild.width, textChild.height);
                    replica.appendChild(textReplica);
                } else {
                    const childClone = child.clone();
                    const transform = child.relativeTransform;
                    childClone.x = transform[0][2];
                    childClone.y = transform[1][2];
                    replica.appendChild(childClone);
                }
            } catch (e) {
                // Um filho problemático não pode derrubar a réplica inteira:
                // tenta um clone simples e, se também falhar, pula o filho.
                console.warn(`Falha ao replicar "${child.name}", usando clone simples:`, e);
                try {
                    const fallbackClone = child.clone();
                    fallbackClone.x = child.relativeTransform[0][2];
                    fallbackClone.y = child.relativeTransform[1][2];
                    replica.appendChild(fallbackClone);
                } catch (_e) { /* filho ignorado */ }
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

function summarizePaints(paints: ReadonlyArray<Paint> | typeof figma.mixed | undefined): string {
    if (paints === undefined) return 'none';
    if (!Array.isArray(paints)) return 'mixed';
    return paints.map(paint => {
        if (paint.visible === false) return 'off';
        if (paint.type === 'SOLID') {
            return `S${rgbToHex(paint.color.r, paint.color.g, paint.color.b)}:${paint.opacity === undefined ? 1 : paint.opacity}`;
        }
        if ('gradientStops' in paint) {
            const stops = paint.gradientStops
                .map((stop: ColorStop) => `${rgbToHex(stop.color.r, stop.color.g, stop.color.b)}@${stop.position.toFixed(2)}`)
                .join(',');
            return `${paint.type}:${stops}`;
        }
        if (paint.type === 'IMAGE') return `IMG:${paint.imageHash || ''}`;
        return paint.type;
    }).join('|');
}

/**
 * Fingerprint estrutural de um nó. Dois nós com o mesmo fingerprint são
 * tratados como o mesmo design. Estritamente igual em tudo, EXCETO:
 * - o conteúdo dos textos (characters) — botões idênticos com labels
 *   diferentes são o mesmo design;
 * - dimensões derivadas do texto (text auto-resize e containers com HUG).
 * Um orçamento de nós visitados evita travamentos em árvores gigantes.
 */
function getNodeFingerprint(node: SceneNode, budget?: { left: number }): string {
    const b = budget || { left: FINGERPRINT_NODE_BUDGET };
    if (--b.left < 0) return `overflow:${node.id};`;

    let fingerprint = `type:${node.type};`;

    if (node.type === 'TEXT') {
        const font = node.fontName === figma.mixed ? 'mixed' : `${node.fontName.family}/${node.fontName.style}`;
        const size = node.fontSize === figma.mixed ? 'mixed' : String(node.fontSize);
        const lineHeight = node.lineHeight === figma.mixed ? 'mixed' : JSON.stringify(node.lineHeight);
        const letterSpacing = node.letterSpacing === figma.mixed ? 'mixed' : JSON.stringify(node.letterSpacing);
        const textCase = node.textCase === figma.mixed ? 'mixed' : String(node.textCase);
        const decoration = node.textDecoration === figma.mixed ? 'mixed' : String(node.textDecoration);
        fingerprint += `font:${font};fsize:${size};lh:${lineHeight};ls:${letterSpacing};case:${textCase};dec:${decoration};`;
        fingerprint += `align:${node.textAlignHorizontal}/${node.textAlignVertical};`;
        fingerprint += `fills:${summarizePaints(node.fills)};`;
        // Texto com auto-resize tem tamanho derivado do conteúdo — não comparar
        if (node.textAutoResize === 'NONE') {
            fingerprint += `size:${node.width.toFixed(0)}x${node.height.toFixed(0)};`;
        }
        return fingerprint;
    }

    if ('fills' in node) fingerprint += `fills:${summarizePaints(node.fills)};`;
    if ('strokes' in node) {
        fingerprint += `strokes:${summarizePaints(node.strokes)};`;
        fingerprint += `sw:${node.strokeWeight === figma.mixed ? 'mixed' : node.strokeWeight};`;
    }
    if ('cornerRadius' in node) {
        fingerprint += `cr:${node.cornerRadius === figma.mixed ? 'mixed' : node.cornerRadius};`;
    }
    if ('effects' in node) fingerprint += `fx:${node.effects.length};`;

    if ('layoutMode' in node && node.layoutMode !== 'NONE') {
        fingerprint += `layout:${node.layoutMode}/${node.primaryAxisAlignItems}/${node.counterAxisAlignItems};`;
        fingerprint += `gap:${node.itemSpacing};pad:${node.paddingTop}/${node.paddingRight}/${node.paddingBottom}/${node.paddingLeft};`;
        // Dimensões HUG derivam do conteúdo (ex.: texto) — não comparar
        const hugH = 'layoutSizingHorizontal' in node && node.layoutSizingHorizontal === 'HUG';
        const hugV = 'layoutSizingVertical' in node && node.layoutSizingVertical === 'HUG';
        fingerprint += `size:${hugH ? 'hug' : node.width.toFixed(0)}x${hugV ? 'hug' : node.height.toFixed(0)};`;
    } else if ('width' in node) {
        fingerprint += `size:${node.width.toFixed(0)}x${node.height.toFixed(0)};`;
    }

    if ('children' in node) {
        fingerprint += `children:${node.children.length};`;
        for (const child of node.children) {
            fingerprint += getNodeFingerprint(child, b);
        }
    }
    return fingerprint;
}

function copyProperties(sourceNode: SceneNode, targetNode: ComponentNode) {
    targetNode.resize(sourceNode.width, sourceNode.height);
    if ('fills' in sourceNode && Array.isArray(sourceNode.fills)) targetNode.fills = sourceNode.fills;
    if ('strokes' in sourceNode && Array.isArray(sourceNode.strokes)) targetNode.strokes = sourceNode.strokes;
    if ('strokeWeight' in sourceNode && sourceNode.strokeWeight !== figma.mixed) targetNode.strokeWeight = sourceNode.strokeWeight;
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
    // (removido: setar propriedades de TextNode num ComponentNode lança erro —
    // textos do source viram filhos clonados, que já carregam o próprio estilo)
}

function rgbToHex(r: number, g: number, b: number): string {
    const toHex = (c: number) => ('0' + Math.round(c * 255).toString(16)).slice(-2);
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function getAngleFromTransform(transform: [[number, number, number], [number, number, number]]): number {
    const [a, b] = transform[0];
    const angleRad = Math.atan2(b, a);
    const angleDeg = angleRad * (180 / Math.PI);
    // Adiciona 90 graus para alinhar com a convenção de CSS (0deg = de baixo para cima)
    // Se preferir 0deg = da esquerda para a direita, remova o "+ 90"
    return (angleDeg + 90) % 360;
}

// =================================================================
// ===== FUNÇÃO DE VISUALIZAÇÃO (CORRIGIDA E REFATORADA) =====
// =================================================================

async function createLayoutVisualization(node: ComponentNode | FrameNode): Promise<FrameNode | null> {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });

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

    // --- ANTI-SOBREPOSIÇÃO DE RÓTULOS ---
    // Rótulos ancorados no mesmo lado podem colidir (ex.: padding pequeno +
    // gap vizinho). Quando colidem, o novo rótulo é empurrado para fora.
    const placedLabels: FrameNode[] = [];
    const labelsIntersect = (a: FrameNode, b: FrameNode) =>
        a.x < b.x + b.width + 2 && a.x + a.width + 2 > b.x &&
        a.y < b.y + b.height + 2 && a.y + a.height + 2 > b.y;
    const registerLabel = (label: FrameNode, pushDirection: 'left' | 'up') => {
        let guard = 0;
        while (placedLabels.some(other => labelsIntersect(label, other)) && guard++ < 20) {
            if (pushDirection === 'left') label.x -= label.width + 4;
            else label.y -= label.height + 4;
        }
        placedLabels.push(label);
    };

    // Paddings iguais nos 4 lados ganham um único rótulo (menos poluição visual)
    const roundedPadding = {
        top: Math.round(componentPiece.paddingTop),
        bottom: Math.round(componentPiece.paddingBottom),
        left: Math.round(componentPiece.paddingLeft),
        right: Math.round(componentPiece.paddingRight)
    };
    const uniformPadding = roundedPadding.top > 0 &&
        roundedPadding.top === roundedPadding.bottom &&
        roundedPadding.top === roundedPadding.left &&
        roundedPadding.top === roundedPadding.right;

    // --- FUNÇÕES AUXILIARES REESTRUTURADAS ---


    const createFullWidthHorizontalLine = (yPos: number, stroke: SolidPaint): LineNode => {
        const line = figma.createLine();
        line.strokes = [stroke];
        line.strokeWeight = 1;
        line.resize(componentPiece.width + LINE_EXTENSION * 2, 0);
        line.x = componentPiece.x - LINE_EXTENSION;
        line.y = yPos;
        return line;
    };

    const createVerticalBoundaryLines = (block: RectangleNode, stroke: SolidPaint): LineNode[] => {
        const line1 = figma.createLine();
        const line2 = figma.createLine();
        line1.strokes = [stroke];
        line2.strokes = [stroke];
        line1.strokeWeight = 1;
        line2.strokeWeight = 1;

        const lineLength = componentPiece.height + LINE_EXTENSION * 2;
        line1.resize(lineLength, 0);
        line2.resize(lineLength, 0);
        line1.rotation = -90;
        line2.rotation = -90;
        
        line1.x = block.x;
        line2.x = block.x + block.width;
        line1.y = componentPiece.y - LINE_EXTENSION;
        line2.y = componentPiece.y - LINE_EXTENSION;

        return [line1, line2];
    };

    // --- LÓGICA DE PADDINGS ---

    if (roundedPadding.top > 0) {
        const topBlock = figma.createRectangle();
        topBlock.resize(componentPiece.width, componentPiece.paddingTop);
        topBlock.x = componentPiece.x;
        topBlock.y = componentPiece.y;
        topBlock.fills = [PADDING_FILL];

        const line1 = createFullWidthHorizontalLine(topBlock.y, PADDING_LINE_STROKE);
        const line2 = createFullWidthHorizontalLine(topBlock.y + topBlock.height, PADDING_LINE_STROKE);
        vizElements.push(topBlock, line1, line2);

        // A âncora do label para paddings verticais (top/bottom) fica à esquerda
        const labelAnchor = { x: componentPiece.x - LINE_EXTENSION - LABEL_MARGIN, y: topBlock.y + topBlock.height / 2 };
        const label = await createLabel(componentPiece.paddingTop, labelAnchor, 'padding', 'left');
        registerLabel(label, 'left');
        vizElements.push(label);
    }

    if (roundedPadding.bottom > 0) {
        const bottomBlock = figma.createRectangle();
        bottomBlock.resize(componentPiece.width, componentPiece.paddingBottom);
        bottomBlock.x = componentPiece.x;
        bottomBlock.y = componentPiece.y + componentPiece.height - componentPiece.paddingBottom;
        bottomBlock.fills = [PADDING_FILL];

        const line1 = createFullWidthHorizontalLine(bottomBlock.y, PADDING_LINE_STROKE);
        const line2 = createFullWidthHorizontalLine(bottomBlock.y + bottomBlock.height, PADDING_LINE_STROKE);
        vizElements.push(bottomBlock, line1, line2);

        if (!uniformPadding) {
            const labelAnchor = { x: componentPiece.x - LINE_EXTENSION - LABEL_MARGIN, y: bottomBlock.y + bottomBlock.height / 2 };
            const label = await createLabel(componentPiece.paddingBottom, labelAnchor, 'padding', 'left');
            registerLabel(label, 'left');
            vizElements.push(label);
        }
    }

    if (roundedPadding.left > 0) {
        const height = componentPiece.height - componentPiece.paddingTop - componentPiece.paddingBottom;
        const leftBlock = figma.createRectangle();
        leftBlock.resize(componentPiece.paddingLeft, height);
        leftBlock.x = componentPiece.x;
        leftBlock.y = componentPiece.y + componentPiece.paddingTop;
        leftBlock.fills = [PADDING_FILL];

        vizElements.push(leftBlock, ...createVerticalBoundaryLines(leftBlock, PADDING_LINE_STROKE));

        if (!uniformPadding) {
            const labelAnchor = { x: leftBlock.x + leftBlock.width / 2, y: componentPiece.y - LINE_EXTENSION - LABEL_MARGIN };
            const label = await createLabel(componentPiece.paddingLeft, labelAnchor, 'padding', 'top');
            registerLabel(label, 'up');
            vizElements.push(label);
        }
    }

    if (roundedPadding.right > 0) {
        const height = componentPiece.height - componentPiece.paddingTop - componentPiece.paddingBottom;
        const rightBlock = figma.createRectangle();
        rightBlock.resize(componentPiece.paddingRight, height);
        rightBlock.x = componentPiece.x + componentPiece.width - componentPiece.paddingRight;
        rightBlock.y = componentPiece.y + componentPiece.paddingTop;
        rightBlock.fills = [PADDING_FILL];

        vizElements.push(rightBlock, ...createVerticalBoundaryLines(rightBlock, PADDING_LINE_STROKE));

        if (!uniformPadding) {
            const labelAnchor = { x: rightBlock.x + rightBlock.width / 2, y: componentPiece.y - LINE_EXTENSION - LABEL_MARGIN };
            const label = await createLabel(componentPiece.paddingRight, labelAnchor, 'padding', 'top');
            registerLabel(label, 'up');
            vizElements.push(label);
        }
    }

    // --- LÓGICA DE GAPS ---

    if ('children' in componentPiece && componentPiece.children.length > 1) {
        let actualItemSpacing = componentPiece.itemSpacing;

        // Se o alinhamento for Space Between, precisamos calcular o espaçamento real
        if (componentPiece.primaryAxisAlignItems === 'SPACE_BETWEEN') {
            const children = componentPiece.children;
            const numGaps = children.length - 1;

            if (numGaps > 0) {
                if (componentPiece.layoutMode === 'HORIZONTAL') {
                    const containerWidth = componentPiece.width - componentPiece.paddingLeft - componentPiece.paddingRight;
                    const totalChildrenWidth = children.reduce((sum, child) => sum + child.width, 0);
                    const totalGapSpace = containerWidth - totalChildrenWidth;
                    actualItemSpacing = totalGapSpace / numGaps;
                } else { // VERTICAL
                    const containerHeight = componentPiece.height - componentPiece.paddingTop - componentPiece.paddingBottom;
                    const totalChildrenHeight = children.reduce((sum, child) => sum + child.height, 0);
                    const totalGapSpace = containerHeight - totalChildrenHeight;
                    actualItemSpacing = totalGapSpace / numGaps;
                }
            }
        }
        
        // Continua apenas se houver um espaçamento real para desenhar
        if (Math.round(actualItemSpacing) > 0) {
            for (let i = 0; i < componentPiece.children.length - 1; i++) {
                const currentChild = componentPiece.children[i];
                if (!('relativeTransform' in currentChild)) continue;

                // Em auto-layout todos os gaps têm o mesmo valor — rotular
                // só o primeiro evita repetição visual desnecessária.
                const showLabel = i === 0;

                const gapBlock = figma.createRectangle();
                gapBlock.fills = [GAP_FILL];
                const childRelativeX = currentChild.relativeTransform[0][2];
                const childRelativeY = currentChild.relativeTransform[1][2];

                if (componentPiece.layoutMode === 'HORIZONTAL') { // Gap Vertical
                    const gapHeight = componentPiece.height - componentPiece.paddingTop - componentPiece.paddingBottom;
                    gapBlock.resize(actualItemSpacing, gapHeight);
                    gapBlock.x = componentPiece.x + childRelativeX + currentChild.width;
                    gapBlock.y = componentPiece.y + componentPiece.paddingTop;

                    vizElements.push(gapBlock, ...createVerticalBoundaryLines(gapBlock, GAP_LINE_STROKE));
                    if (showLabel) {
                        const labelAnchor = { x: gapBlock.x + gapBlock.width / 2, y: componentPiece.y - LINE_EXTENSION - LABEL_MARGIN };
                        const label = await createLabel(actualItemSpacing, labelAnchor, 'gap', 'top');
                        registerLabel(label, 'up');
                        vizElements.push(label);
                    }

                } else { // layoutMode === 'VERTICAL' -> Gap Horizontal
                    const gapWidth = componentPiece.width - componentPiece.paddingLeft - componentPiece.paddingRight;
                    gapBlock.resize(gapWidth, actualItemSpacing);
                    gapBlock.x = componentPiece.x + componentPiece.paddingLeft;
                    gapBlock.y = componentPiece.y + childRelativeY + currentChild.height;

                    const line1 = createFullWidthHorizontalLine(gapBlock.y, GAP_LINE_STROKE);
                    const line2 = createFullWidthHorizontalLine(gapBlock.y + gapBlock.height, GAP_LINE_STROKE);
                    vizElements.push(gapBlock, line1, line2);
                    if (showLabel) {
                        const labelAnchor = { x: componentPiece.x - LINE_EXTENSION - LABEL_MARGIN, y: gapBlock.y + gapBlock.height / 2 };
                        const label = await createLabel(actualItemSpacing, labelAnchor, 'gap', 'left');
                        registerLabel(label, 'left');
                        vizElements.push(label);
                    }
                }
            }
        }
    }

    // --- FINALIZAÇÃO ---

    if (vizElements.length > 0) {
        vizElements.forEach(el => vizWrapperFrame.appendChild(el));

        // Expande o wrapper para conter rótulos e linhas que sobressaem —
        // com clipsContent=false eles aparecem, mas o frame menor que o
        // conteúdo quebra o auto-layout do box de documentação.
        const wrapperAbsX = vizWrapperFrame.absoluteTransform[0][2];
        const wrapperAbsY = vizWrapperFrame.absoluteTransform[1][2];
        let minX = 0, minY = 0;
        let maxX = vizWrapperFrame.width, maxY = vizWrapperFrame.height;
        for (const child of vizWrapperFrame.children) {
            const box = child.absoluteBoundingBox;
            if (!box) continue;
            const relX = box.x - wrapperAbsX;
            const relY = box.y - wrapperAbsY;
            minX = Math.min(minX, relX);
            minY = Math.min(minY, relY);
            maxX = Math.max(maxX, relX + box.width);
            maxY = Math.max(maxY, relY + box.height);
        }
        if (minX < 0 || minY < 0 || maxX > vizWrapperFrame.width || maxY > vizWrapperFrame.height) {
            const dx = Math.max(0, -minX);
            const dy = Math.max(0, -minY);
            for (const child of vizWrapperFrame.children) {
                child.x += dx;
                child.y += dy;
            }
            vizWrapperFrame.resize(maxX - minX, maxY - minY);
        }

        return vizWrapperFrame;
    }

    if (node.type !== 'COMPONENT') {
        componentPiece.remove();
    }
    vizWrapperFrame.remove();
    return null;
}


// =================================================================
// ===== FUNÇÕES DE DOCUMENTAÇÃO =====
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

    if ('fills' in node && Array.isArray(node.fills) && node.fills.length > 0) {
        const firstFill = node.fills[0];
        let backgroundLabel = '';

        switch (firstFill.type) {
            case 'SOLID': {
                const colorInfo = await getColorInfo(firstFill, node.fillStyleId);
                const label = colorInfo.name ? `${colorInfo.name} (${colorInfo.hex})` : colorInfo.hex;
                backgroundLabel = `Background color: ${label}`;
                break;
            }
            case 'GRADIENT_LINEAR': {
                // Usa a nova função para obter o ângulo
                const angle = getAngleFromTransform(firstFill.gradientTransform).toFixed(1);

                // Mapeia cada "stop" de cor para uma string legível
                const colorStops = firstFill.gradientStops.map((stop: ColorStop) => {
                    const hex = rgbToHex(stop.color.r, stop.color.g, stop.color.b);
                    const position = Math.round(stop.position * 100);
                    return `${hex} em ${position}%`;
                }).join(', ');
                
                backgroundLabel = `Background: Linear Gradient ${angle}°, ${colorStops}`;
                break;
            }
            // Você pode adicionar outros casos aqui (GRADIENT_RADIAL, IMAGE, etc.) no futuro
            default:
                backgroundLabel = `Background: ${firstFill.type} (não documentado)`;
                break;
        }

        if (backgroundLabel) {
            frame.appendChild(createText(backgroundLabel));
        }
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
    if (node.primaryAxisAlignItems === 'SPACE_BETWEEN') {
    frame.appendChild(createText(`Item spacing: Auto (Space Between)`));
    } else {
        frame.appendChild(createText(`Item spacing: ${node.itemSpacing}`));
    }
    const { paddingTop, paddingRight, paddingBottom, paddingLeft } = node;
    if (paddingTop === paddingRight && paddingTop === paddingBottom && paddingTop === paddingLeft) {
        frame.appendChild(createText(`Padding: ${paddingTop}`));
    } else {
        frame.appendChild(createText(`Padding T/R/B/L: ${paddingTop}/${paddingRight}/${paddingBottom}/${paddingLeft}`));
    }
    return frame;
}

/**
 * Cria um frame de documentação para as proporções dos itens filhos,
 * exibindo suas porcentagens de tamanho apenas quando for contextualmente relevante.
 */
async function createProportionsFrame(node: FrameNode | ComponentNode | InstanceNode): Promise<FrameNode | null> {
    // 1. Verifica se o nó tem Auto Layout e filhos para analisar.
    if (!('layoutMode' in node) || node.layoutMode === 'NONE' || !node.children || node.children.length === 0) {
        return null;
    }

    // Carrega a fonte necessária para os textos da documentação.
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    await figma.loadFontAsync({ family: "Inter", style: "Bold" });

    // 2. Cria o contêiner principal para esta seção da documentação.
    const frame = figma.createFrame();
    frame.name = "Proportions";
    frame.layoutMode = "VERTICAL";
    frame.primaryAxisSizingMode = "AUTO";
    frame.counterAxisSizingMode = "AUTO";
    frame.itemSpacing = 8;
    frame.paddingTop = 16;
    frame.paddingBottom = 16;
    frame.paddingLeft = 16;
    frame.paddingRight = 16;
    frame.fills = [];

    const createText = (content: string, isBold = false) => {
        const text = figma.createText();
        text.fontName = { family: "Inter", style: isBold ? "Bold" : "Regular" };
        text.characters = content;
        text.fontSize = 12;
        return text;
    };

    frame.appendChild(createText("Item Proportions", true));

    const isHorizontal = node.layoutMode === 'HORIZONTAL';
    const parentSizingMode = isHorizontal ? node.layoutSizingHorizontal : node.layoutSizingVertical;

    // 3. Lógica principal: Verifica se o pai tem tamanho dinâmico ('Hug').
    // Se tiver, as porcentagens não são estáveis e não devem ser mostradas.
    if (parentSizingMode === 'HUG') {
        frame.appendChild(createText("Parent size is dynamic (Hug Contents), percentages are not applicable."));
        return frame;
    }

    // 4. Calcula a dimensão interna do contêiner (tamanho total menos paddings).
    const parentInnerSize = isHorizontal 
        ? node.width - node.paddingLeft - node.paddingRight
        : node.height - node.paddingTop - node.paddingBottom;

    // Se o tamanho interno for zero ou negativo, não há o que calcular.
    if (parentInnerSize <= 0) {
        frame.appendChild(createText("No internal space to calculate proportions."));
        return frame;
    }
    
    // 5. Itera sobre cada filho para calcular e exibir sua proporção.
    for (const child of node.children) {
        if (!('width' in child && 'height' in child)) continue;

        const childSize = isHorizontal ? child.width : child.height;
        const childSizingMode = isHorizontal ? ('layoutSizingHorizontal' in child ? child.layoutSizingHorizontal : 'FIXED') : ('layoutSizingVertical' in child ? child.layoutSizingVertical : 'FIXED');
        
        // Calcula a porcentagem
        const percentage = (childSize / parentInnerSize) * 100;

        // Formata o modo de dimensionamento para ser mais legível
        const sizingModeLabel = {
            'FIXED': 'Fixed',
            'HUG': 'Hug',
            'FILL': 'Fill'
        }[childSizingMode];

        const description = `› ${child.name}: ${percentage.toFixed(1)}% (${sizingModeLabel})`;
        frame.appendChild(createText(description));
    }

    return frame;
}

function findTextNodes(node: SceneNode): TextNode[] {
    let textNodes: TextNode[] = [];
    if (node.type === 'TEXT') {
        textNodes.push(node);
    }
    if ('children' in node) {
        for (const child of node.children) {
            textNodes = textNodes.concat(findTextNodes(child));
        }
    }
    return textNodes;
}

/**
 * Cria um "card" de documentação para um único nó de texto, detalhando suas propriedades.
 */
async function createTypographyFrame(textNode: TextNode): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name = `Typography: ${textNode.name}`;
  frame.layoutMode = "VERTICAL";
  frame.primaryAxisSizingMode = "AUTO";
  frame.counterAxisSizingMode = "AUTO";
  frame.itemSpacing = 8;
  frame.paddingTop = 16;
  frame.paddingBottom = 16;
  frame.paddingLeft = 16;
  frame.paddingRight = 16;
  frame.fills = [];

  const createText = (content: string, isBold = false) => {
    const text = figma.createText();
    text.fontName = { family: "Inter", style: isBold ? "Bold" : "Regular" };
    text.characters = content;
    text.fontSize = 12;
    return text;
  };

  await figma.loadFontAsync(textNode.fontName as FontName);

  // Título da seção
  frame.appendChild(createText("Typography", true));

  // 👉 Prévia do conteúdo do texto (com reticências apenas se > 2 palavras)
  const words = textNode.characters.trim().split(/\s+/);
  let previewLabel = "";

  if (words.length === 0 || (words.length === 1 && words[0] === "")) {
    previewLabel = "(empty)";
  } else if (words.length <= 2) {
    previewLabel = `“${words.join(" ")}”`;
  } else {
    previewLabel = `“${words.slice(0, 2).join(" ")}...”`;
  }

  frame.appendChild(createText(`Preview: ${previewLabel}`));

  // Fonte
  const fontName = textNode.fontName as FontName;
  frame.appendChild(createText(`Font: ${fontName.family} ${fontName.style}`));

  // Cor
  if (Array.isArray(textNode.fills) && textNode.fills.length > 0 && textNode.fills[0].type === 'SOLID') {
    const colorInfo = await getColorInfo(textNode.fills[0], textNode.fillStyleId);
    const label = colorInfo.name ? `${colorInfo.name} (${colorInfo.hex})` : colorInfo.hex;
    frame.appendChild(createText(`Color: ${label}`));
  }

  // Tamanho
  if (typeof textNode.fontSize === 'number') {
    frame.appendChild(createText(`Size: ${textNode.fontSize}px`));
  } else {
    frame.appendChild(createText('Size: Mixed'));
  }

  // Line height
  const lineHeight = textNode.lineHeight;
  if (lineHeight === figma.mixed) {
    frame.appendChild(createText('Line Height: Mixed'));
  } else if (lineHeight.unit === 'AUTO') {
    frame.appendChild(createText('Line Height: Auto'));
  } else {
    const value = lineHeight.value.toFixed(lineHeight.unit === 'PIXELS' ? 0 : 2);
    frame.appendChild(createText(`Line Height: ${value}${lineHeight.unit === 'PIXELS' ? 'px' : '%'}`));
  }

  // Letter spacing
  const letterSpacing = textNode.letterSpacing;
  if (letterSpacing === figma.mixed) {
    frame.appendChild(createText('Letter Spacing: Mixed'));
  } else {
    const lsValue = letterSpacing.value.toFixed(letterSpacing.unit === 'PIXELS' ? 2 : 1);
    frame.appendChild(createText(`Letter Spacing: ${lsValue}${letterSpacing.unit === 'PIXELS' ? 'px' : '%'}`));
  }

  // Alinhamento
  frame.appendChild(createText(`Alignment: ${textNode.textAlignHorizontal} / ${textNode.textAlignVertical}`));

  // Decoração e Case
  if (textNode.textDecoration !== 'NONE') {
    frame.appendChild(createText(`Decoration: ${String(textNode.textDecoration)}`));
  }
  if (textNode.textCase !== 'ORIGINAL') {
    frame.appendChild(createText(`Case: ${String(textNode.textCase)}`));
  }

  return frame;
}

/**
 * Encontra todos os estilos de texto únicos em um nó e cria um contêiner com sua documentação.
 */
async function createAllTypographyFrames(node: SceneNode): Promise<FrameNode | null> {
    const textNodes = findTextNodes(node);
    if (textNodes.length === 0) {
        return null;
    }

    // Filtra para documentar apenas estilos de texto únicos
    const uniqueTextStyles = new Map<string, TextNode>();
    for (const textNode of textNodes) {
        // Cria uma "impressão digital" do estilo para identificar duplicatas
        const styleFingerprint = JSON.stringify({
            font: textNode.fontName,
            size: textNode.fontSize,
            fills: textNode.fills,
            lineHeight: textNode.lineHeight,
            letterSpacing: textNode.letterSpacing,
            textCase: textNode.textCase,
            textDecoration: textNode.textDecoration
        });
        
        if (!uniqueTextStyles.has(styleFingerprint)) {
            uniqueTextStyles.set(styleFingerprint, textNode);
        }
    }

    if (uniqueTextStyles.size === 0) {
        return null;
    }

    // Cria o contêiner principal para todos os cards de tipografia
    const typographyContainer = figma.createFrame();
    typographyContainer.name = "Typography";
    typographyContainer.layoutMode = 'VERTICAL';
    typographyContainer.primaryAxisSizingMode = 'AUTO';
    typographyContainer.counterAxisSizingMode = 'AUTO';
    typographyContainer.itemSpacing = 16;
    typographyContainer.fills = [];

    // Cria um card de documentação para cada estilo único
    for (const textNode of uniqueTextStyles.values()) {
        const typoFrame = await createTypographyFrame(textNode);
        typographyContainer.appendChild(typoFrame);
    }
    
    return typographyContainer;
}

function findNestedFramesWithLayout(node: SceneNode, depth = 1): FrameNode[] {
    let frames: FrameNode[] = [];
    // Limite de profundidade: documentar TODOS os níveis de um design complexo
    // explode o box e trava o plugin — os primeiros níveis são os que importam.
    if (depth > NESTED_DOC_MAX_DEPTH || !('children' in node)) return frames;
    for (const child of node.children) {
        if (child.type === 'FRAME' && child.layoutMode !== 'NONE') {
            frames.push(child);
        }
        frames = frames.concat(findNestedFramesWithLayout(child, depth + 1));
    }
    return frames;
}

/**
 * Remove frames com design idêntico (fingerprint estrutural — ignora apenas o
 * conteúdo dos textos) e aplica o teto de segurança de nested docs.
 * Retorna cada frame único com a contagem de ocorrências.
 */
function dedupeNestedFrames(frames: FrameNode[]): { frame: FrameNode; count: number }[] {
    const seen = new Map<string, { frame: FrameNode; count: number }>();
    for (const frame of frames) {
        const fingerprint = getNodeFingerprint(frame);
        const entry = seen.get(fingerprint);
        if (entry) entry.count++;
        else seen.set(fingerprint, { frame, count: 1 });
    }
    const unique = [...seen.values()];
    if (unique.length > NESTED_DOC_MAX_COUNT) {
        figma.notify(`ℹ️ ${unique.length - NESTED_DOC_MAX_COUNT} camadas internas omitidas da documentação (limite de ${NESTED_DOC_MAX_COUNT}).`);
        return unique.slice(0, NESTED_DOC_MAX_COUNT);
    }
    return unique;
}

async function createNestedFrameDocumentation(nestedFrame: FrameNode, occurrences = 1): Promise<FrameNode> {
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
    title.characters = `Layer: ${nestedFrame.name}${occurrences > 1 ? ` ×${occurrences}` : ''}`;
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

    const vizColumn = figma.createFrame();
    vizColumn.name = "Nested Viz Preview";
    vizColumn.backgrounds = [];

    // --- MELHORIA APLICADA AQUI ---
    // Usamos Auto Layout para criar um "respiro" em volta da visualização.
    const PADDING_VIZ = 10; // 10px em cada lado = 20px maior no total
    vizColumn.layoutMode = 'VERTICAL';
    vizColumn.primaryAxisSizingMode = 'AUTO';   // Hug Height
    vizColumn.counterAxisSizingMode = 'AUTO';   // Hug Width
    vizColumn.primaryAxisAlignItems = 'CENTER'; // Centraliza verticalmente
    vizColumn.counterAxisAlignItems = 'CENTER'; // Centraliza horizontalmente
    vizColumn.paddingTop = PADDING_VIZ;
    vizColumn.paddingBottom = PADDING_VIZ;
    vizColumn.paddingLeft = PADDING_VIZ;
    vizColumn.paddingRight = PADDING_VIZ;
    // --- FIM DA MELHORIA ---

    const layoutViz = await createLayoutVisualization(nestedFrame);
    if (layoutViz) {
        // As linhas de resize e posicionamento (x, y) não são mais necessárias
        // pois o Auto Layout do vizColumn cuidará disso.
        vizColumn.appendChild(layoutViz);
    } else {
        const replica = await createVisualReplica(nestedFrame);
        vizColumn.appendChild(replica);
    }
    
    contentRow.appendChild(vizColumn);
    
    contentRow.appendChild(await createPropertiesFrame(nestedFrame));
    const spacingFrame = await createSpacingFrame(nestedFrame);
    if (spacingFrame) {
        contentRow.appendChild(spacingFrame);
    }

    const proportionsFrame = await createProportionsFrame(nestedFrame);
    if (proportionsFrame) {
        contentRow.appendChild(proportionsFrame);
    }
    
    const allSvgsFrame = await createAllAssetsSVGFrame(nestedFrame); // Usando a função que criamos antes
    if (allSvgsFrame) {
        contentRow.appendChild(allSvgsFrame);
    }
    
    docContainer.appendChild(contentRow);
    return docContainer;
}

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
            const variantContainer = figma.createFrame();
            variantContainer.name = `Container for ${variant.name}`;
            variantContainer.layoutMode = "VERTICAL";
            variantContainer.primaryAxisSizingMode = "AUTO";
            variantContainer.counterAxisSizingMode = "AUTO";
            variantContainer.itemSpacing = 32;
            variantContainer.fills = [];

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

            const proportionsFrame = await createProportionsFrame(variant);
            if (proportionsFrame) {
                mainVariantRow.appendChild(proportionsFrame);
            }

            // --- CORREÇÃO APLICADA AQUI ---
            // Chama a nova função que cria um contêiner para TODOS os SVGs
            const allSvgsFrame = await createAllAssetsSVGFrame(variant);
            if (allSvgsFrame) {
                mainVariantRow.appendChild(allSvgsFrame);
            }

            const allTypographyFrame = await createAllTypographyFrames(variant);
            if (allTypographyFrame) {
                mainVariantRow.appendChild(allTypographyFrame);
            }
            // --- FIM DA CORREÇÃO ---
            
            variantContainer.appendChild(mainVariantRow);
            
            if (makeBox) {
                const nestedFrames = dedupeNestedFrames(findNestedFramesWithLayout(variant));
                if (nestedFrames.length > 0) {
                    const separator = figma.createRectangle();
                    separator.resize(600, 1);
                    separator.fills = [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8 } }];
                    variantContainer.appendChild(separator);

                    for (const { frame: nestedFrame, count } of nestedFrames) {
                        const nestedDoc = await createNestedFrameDocumentation(nestedFrame, count);
                        variantContainer.appendChild(nestedDoc);
                    }
                }
            }
            sectionFrame.appendChild(variantContainer);
        }
    }
    return sectionFrame;
}

async function createDocumentationBox(
    componentOrSet: ComponentNode | ComponentSetNode, 
    componentName: string, 
    makeBox: boolean,
    docs: { description: string; location: string; behavior: string }
): Promise<FrameNode> {
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
    leftColumn.itemSpacing = 24; // Espaçamento entre os itens na coluna
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
    title.layoutAlign = 'STRETCH';
    leftColumn.appendChild(title);
    
    leftColumn.appendChild(componentOrSet);

    // --- LÓGICA MOVIDA E CORRIGIDA PARA A COLUNA DA ESQUERDA ---
    const descSection = await createDocumentationSection("Description", docs.description);
    const locSection = await createDocumentationSection("Location", docs.location);
    const behSection = await createDocumentationSection("Behavior", docs.behavior);

    // Adiciona um separador apenas se houver alguma seção de documentação
    if (descSection || locSection || behSection) {
        const separator = figma.createRectangle();
        separator.name = "Separator";
        separator.resize(100, 1); // A largura não importa, pois usará STRETCH
        separator.layoutAlign = 'STRETCH';
        separator.fills = [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8 } }];
        leftColumn.appendChild(separator);
    }

    if (descSection) {
        leftColumn.appendChild(descSection);
        descSection.layoutAlign = 'STRETCH'; // <<< MUDANÇA CRÍTICA: Faz a seção ocupar toda a largura
    }
    if (locSection) {
        leftColumn.appendChild(locSection);
        locSection.layoutAlign = 'STRETCH'; // <<< MUDANÇA CRÍTICA: Faz a seção ocupar toda a largura
    }
    if (behSection) {
        leftColumn.appendChild(behSection);
        behSection.layoutAlign = 'STRETCH'; // <<< MUDANÇA CRÍTICA: Faz a seção ocupar toda a largura
    }
    // --- FIM DA LÓGICA MOVIDA ---

    boxDS.appendChild(leftColumn);

    // --- COLUNA DA DIREITA (SEM A LÓGICA DE DOCUMENTAÇÃO AGORA) ---
    const rightColumn = figma.createFrame();
    rightColumn.name = "Component Specs";
    rightColumn.layoutMode = "VERTICAL";
    rightColumn.primaryAxisSizingMode = "AUTO";
    rightColumn.counterAxisSizingMode = "AUTO";
    rightColumn.itemSpacing = 24;
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

        const proportionsFrame = await createProportionsFrame(componentOrSet as ComponentNode);
        if (proportionsFrame) {
            mainSpecsContainer.appendChild(proportionsFrame);
        }

        const allTypographyFrame = await createAllTypographyFrames(componentOrSet);
        if (allTypographyFrame) {
            mainSpecsContainer.appendChild(allTypographyFrame);
        }

        rightColumn.appendChild(mainSpecsContainer);

        if (makeBox) {
            const layoutViz = await createLayoutVisualization(componentOrSet);
            if (layoutViz) {
                rightColumn.appendChild(layoutViz);
            }
            const nestedFrames = dedupeNestedFrames(findNestedFramesWithLayout(componentOrSet));
            if (nestedFrames.length > 0) {
                 const separator = figma.createRectangle();
                 separator.resize(600, 1);
                 separator.fills = [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8 } }];
                 rightColumn.appendChild(separator);
                 for (const { frame: nestedFrame, count } of nestedFrames) {
                      const nestedDoc = await createNestedFrameDocumentation(nestedFrame, count);
                      rightColumn.appendChild(nestedDoc);
                 }
            }
        }
    }
    
    boxDS.appendChild(rightColumn);
    // Posicionamento fica a cargo do chamador (placeNearSelection)
    return boxDS;
}

// =================================================================
// ===== LÓGICA PRINCIPAL DO PLUGIN =====
// =================================================================

figma.showUI(__html__, { width: 340, height: 420 });

function updateSelectionInfo() {
    const selection = figma.currentPage.selection;
    figma.ui.postMessage({
        type: 'selection-info',
        count: selection.length,
        firstName: selection.length > 0 ? selection[0].name : ''
    });
}
updateSelectionInfo();
figma.on('selectionchange', updateSelectionInfo);

/**
 * Cria um componente a partir de um nó. Nós com children têm os filhos
 * clonados e as propriedades copiadas (comportamento original). Nós sem
 * children (vetores, boolean operations, formas — ex.: um SVG achatado) são
 * clonados inteiros para dentro do componente, senão ele ficaria vazio —
 * nesse caso as fills/strokes ficam só no clone, não no componente.
 */
function createComponentFrom(sourceNode: SceneNode, name: string): ComponentNode {
    const component = figma.createComponent();
    component.name = name;
    if ('children' in sourceNode && sourceNode.children.length > 0) {
        for (const child of sourceNode.children) component.appendChild(child.clone());
        copyProperties(sourceNode, component);
    } else {
        const clone = sourceNode.clone();
        clone.x = 0;
        clone.y = 0;
        component.resize(Math.max(sourceNode.width, 0.01), Math.max(sourceNode.height, 0.01));
        component.fills = [];
        component.appendChild(clone);
    }
    return component;
}

figma.ui.onmessage = async (msg) => {
    // --- NOVA LÓGICA PARA REDIMENSIONAR A JANELA ---
    if (msg.type === 'resize') {
        figma.ui.resize(340, msg.height);
        return;
    }
    
    if (msg.type === 'cancel') {
        figma.closePlugin();
        return;
    }

    const selection = figma.currentPage.selection;
    if (selection.length < 1) {
        figma.notify("⚠️ Por favor, selecione pelo menos um objeto.", { error: true });
        figma.ui.postMessage({ type: 'done' });
        return;
    }
    const componentName = msg.name || selection[0].name;

    // --- OBJETO COM OS DADOS DA DOCUMENTAÇÃO ---
    const docData = {
        description: msg.description,
        location: msg.location,
        behavior: msg.behavior,
    };

    if (msg.type === 'create-master-component') {
        await runSafely('criar o componente', async () => {
            // Bounds calculados ANTES de remover os originais
            const selectionBounds = getSelectionBounds(selection);
            const masterNode = selection[0];
            const mainComponent = createComponentFrom(masterNode, componentName);

            if (msg.makeBox) {
                const boxDS = await createDocumentationBox(mainComponent, componentName, msg.makeBox, docData);
                placeNearSelection(boxDS, selectionBounds);
            } else {
                placeNearSelection(mainComponent, selectionBounds);
            }

            // Substituição roda por último: se algo acima falhar, os originais ficam intactos
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
                    await applyTextOverrides(instance, originalNode);
                    originalNode.remove();
                }
            }
            figma.notify(`✅ Componente "${mainComponent.name}" criado!`);
        });
    }

    if (msg.type === 'create-component-set') {
        if (selection.length < 2) {
            figma.notify("⚠️ Selecione pelo menos dois objetos para um component set.", { error: true });
            figma.ui.postMessage({ type: 'done' });
            return;
        }
        // Agrupamento por fingerprint estrutural: objetos estritamente iguais
        // exceto pelo texto caem no mesmo grupo (1 variante única).
        const groups = new Map<string, SceneNode[]>();
        selection.forEach(node => {
            const fingerprint = getNodeFingerprint(node);
            if (!groups.has(fingerprint)) groups.set(fingerprint, []);
            groups.get(fingerprint)!.push(node);
        });
        if (groups.size < 2) {
            figma.notify("⚠️ Você precisa de pelo menos dois tipos de objetos diferentes para criar variantes.", { error: true });
            figma.ui.postMessage({ type: 'done' });
            return;
        }
        await runSafely('criar o component set', async () => {
            const selectionBounds = getSelectionBounds(selection);
            const variantComponents: ComponentNode[] = [];
            const nodeToVariantMap = new Map<string, ComponentNode>();
            let variantIndex = 1;
            for (const [, nodes] of groups.entries()) {
                const representativeNode = nodes[0];
                const variantName = msg.useLayerName ? `Type=${representativeNode.name}` : `Variant=${variantIndex++}`;
                const newComponent = createComponentFrom(representativeNode, variantName);
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
                const boxDS = await createDocumentationBox(componentSet, componentName, msg.makeBox, docData);
                placeNearSelection(boxDS, selectionBounds);
            } else {
                placeNearSelection(componentSet, selectionBounds);
            }

            // Substituição roda por último: se algo acima falhar, os originais ficam intactos
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
                        // Originais unificados na mesma variante mantêm o próprio texto
                        await applyTextOverrides(instance, originalNode);
                        originalNode.remove();
                    }
                }
            }
            figma.notify(`✅ Component Set "${componentSet.name}" criado com ${groups.size} variantes!`);
        });
    }
};

